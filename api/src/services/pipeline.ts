/**
 * Pipeline Service — EC-CIM Two-Pass Execution Orchestrator
 *
 * Runs the EC-CIM pipeline against a stored CIM PDF:
 *   1. Fetches deal + CIM from Supabase
 *   2. Pass 1: CIM PDF → Quality Gate + claim register
 *   3. Pass 2: Claim register → Stages 2–5 + IC Insights
 *   4. Builds output files (Dataset D, IC Insights, Synopsis)
 *   5. Uploads outputs to Supabase Storage
 *   6. Resolves payment (capture or release)
 *   7. Sends delivery email
 *
 * Abort handling:
 *   - CIM_ERR_041 (Quality Gate fail) → skip retry, release immediately
 *   - Other abort codes → retry once via shouldRetry(), then release
 *   - Promo deals (payment_amount_cents = 0) → no payment action
 */

import { supabase } from "../lib/supabase.js";
import { executePass1, executePass2, PipelinePassResult } from "../lib/anthropic.js";
import { resolvePayment, shouldRetry } from "./payment.js";
import { buildOutputFiles, PipelineOutputs } from "./outputBuilder.js";
import { uploadAndDeliver } from "./delivery.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Deal {
  id: string;
  deal_name: string;
  sender_email: string;
  firm_id: string;
  cim_storage_path: string;
  status: string;
  claim_depth: "CORE" | "FULL";
  stripe_payment_intent_id: string | null;
  payment_amount_cents: number | null;
}

interface PipelineResult {
  success: boolean;
  abortCode?: string;
  abortReason?: string;
  qualityGate?: Record<string, unknown>;
  stage1?: Record<string, unknown>;
  stage2?: Record<string, unknown>;
  stage3?: Record<string, unknown>;
  stage4?: Record<string, unknown>;
  stage5?: Record<string, unknown>;
  icInsights?: Record<string, unknown>;
  synopsis?: string;
  tokenUsage?: { totalInput: number; totalOutput: number };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function executePipeline(dealId: string): Promise<void> {
  let deal: Deal;

  try {
    deal = await fetchDeal(dealId);
  } catch (err) {
    console.error("[pipeline] Failed to fetch deal " + dealId + ":", err);
    return;
  }

  // Guard: only run from expected statuses
  if (deal.status !== "pipeline_queued" && deal.status !== "received") {
    console.warn(
      "[pipeline] Deal " + dealId + " is in status '" + deal.status + "', expected 'pipeline_queued'. Skipping."
    );
    return;
  }

  // Transition to pipeline_running
  await updateDealStatus(dealId, "pipeline_running");

  console.log(
    "[pipeline] Starting pipeline for deal " + dealId + " (" + deal.deal_name + ") — " + deal.claim_depth + " depth"
  );

  // --- First attempt ---
  let result = await runPipeline(deal);

  if (!result.success && result.abortCode) {
    console.warn(
      "[pipeline] Deal " + dealId + " aborted on first attempt: " + result.abortCode + " — " + result.abortReason
    );

    // Record abort on the deal
    await recordAbort(dealId, result.abortCode, result.abortReason || "");

    // Check retry eligibility
    if (shouldRetry(result.abortCode)) {
      console.log("[pipeline] Retrying deal " + dealId + " (abort code " + result.abortCode + " is retryable)");

      // Clear abort fields before retry
      await clearAbort(dealId);
      result = await runPipeline(deal);

      if (!result.success && result.abortCode) {
        console.warn(
          "[pipeline] Deal " + dealId + " aborted on retry: " + result.abortCode + " — " + result.abortReason
        );
        await recordAbort(dealId, result.abortCode, result.abortReason || "");
      }
    }
  }

  // --- Resolve outcome ---
  if (result.success) {
    await handleSuccess(deal, result);
  } else {
    await handleFailure(deal, result);
  }
}

/**
 * Fire-and-forget trigger for pipeline execution.
 * Catches all errors to prevent unhandled promise rejections.
 * Use this from webhook handlers and the configure endpoint.
 */
export function triggerPipeline(dealId: string): void {
  executePipeline(dealId).catch((err) => {
    console.error("[pipeline] Unhandled error for deal " + dealId + ":", err);
    // Attempt to set deal to a failed state
    updateDealStatus(dealId, "aborted_not_charged").catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Pipeline execution (single attempt)
// ---------------------------------------------------------------------------

async function runPipeline(deal: Deal): Promise<PipelineResult> {
  let totalInput = 0;
  let totalOutput = 0;

  // ---- Download CIM PDF from Supabase Storage ----
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await downloadCim(deal.cim_storage_path);
  } catch (err) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_001",
      abortReason: "Failed to download CIM: " + (err instanceof Error ? err.message : String(err)),
    };
  }

  // Extract filename from storage path for the run command
  const sourceFilename = deal.cim_storage_path.split("/").pop() || "CIM.pdf";

  // ---- Pass 1: CIM PDF → Quality Gate + Stage 1 ----
  let pass1: PipelinePassResult;
  try {
    pass1 = await executePass1(pdfBuffer, deal.claim_depth, sourceFilename);
    totalInput += pass1.inputTokens;
    totalOutput += pass1.outputTokens;
  } catch (err) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_002",
      abortReason: "Pass 1 API call failed: " + (err instanceof Error ? err.message : String(err)),
    };
  }

  // Check for truncation
  if (pass1.truncated) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_003",
      abortReason: "Pass 1 response truncated (max_tokens reached)",
    };
  }

  // Parse Pass 1 JSON
  if (!pass1.json) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_004",
      abortReason: "Pass 1 returned no parseable JSON",
    };
  }

  const pass1Data = pass1.json as Record<string, unknown>;

  // DEBUG: Log Pass 1 structure
  console.log("[pipeline] Pass 1 top-level keys: " + Object.keys(pass1Data).join(", "));

  // Check for EC-CIM abort in Pass 1 output
  const pass1Abort = extractAbort(pass1Data);
  if (pass1Abort) {
    return {
      success: false,
      abortCode: pass1Abort.code,
      abortReason: pass1Abort.reason,
      qualityGate: pass1Data.cim_quality_gate as Record<string, unknown> | undefined,
    };
  }

  // Extract Quality Gate result
  const qualityGate = pass1Data.cim_quality_gate as Record<string, unknown> | undefined;
  const gateDecision = qualityGate?.gate_decision as string | undefined;

  if (gateDecision === "FAIL") {
    return {
      success: false,
      abortCode: "CIM_ERR_041",
      abortReason: "CIM Quality Gate FAIL — score: " + qualityGate?.quality_score,
      qualityGate,
    };
  }

  console.log(
    "[pipeline] Pass 1 complete for deal " + deal.id + " — " +
      ((pass1Data.claims as unknown[])?.length || 0) + " claims, " +
      "gate: " + gateDecision + ", " +
      "tokens: " + pass1.inputTokens + "/" + pass1.outputTokens
  );

  // ---- Pass 2: Stage 1 JSON → Stages 2–5 + IC Insights ----
  let pass2: PipelinePassResult;
  try {
    pass2 = await executePass2(pass1Data, deal.claim_depth);
    totalInput += pass2.inputTokens;
    totalOutput += pass2.outputTokens;
  } catch (err) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_005",
      abortReason: "Pass 2 API call failed: " + (err instanceof Error ? err.message : String(err)),
    };
  }

  if (pass2.truncated) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_006",
      abortReason: "Pass 2 response truncated (max_tokens reached)",
    };
  }

  if (!pass2.json) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_007",
      abortReason: "Pass 2 returned no parseable JSON",
    };
  }

  const pass2Data = pass2.json as Record<string, unknown>;

  // DEBUG: Log Pass 2 structure
  console.log("[pipeline] Pass 2 top-level keys: " + Object.keys(pass2Data).join(", "));
  console.log("[pipeline] Pass 2 JSON sample: " + JSON.stringify(pass2Data).slice(0, 2000));

  // Check for EC-CIM abort in Pass 2 output
  const pass2Abort = extractAbort(pass2Data);
  if (pass2Abort) {
    return {
      success: false,
      abortCode: pass2Abort.code,
      abortReason: pass2Abort.reason,
      qualityGate,
      stage1: pass1Data,
    };
  }

  console.log(
    "[pipeline] Pass 2 complete for deal " + deal.id + " — " +
      "tokens: " + pass2.inputTokens + "/" + pass2.outputTokens
  );

  // ---- Assemble full pipeline result ----
  return {
    success: true,
    qualityGate,
    stage1: pass1Data,
    stage2: extractStage(pass2Data, 2),
    stage3: extractStage(pass2Data, 3),
    stage4: extractStage(pass2Data, 4),
    stage5: extractStage(pass2Data, 5),
    icInsights: pass2Data.ic_insights as Record<string, unknown> | undefined,
    synopsis: (pass2Data.synopsis as string) || (pass2Data.workstream_synopsis as string),
    tokenUsage: { totalInput, totalOutput },
  };
}

// ---------------------------------------------------------------------------
// Success / failure handlers
// ---------------------------------------------------------------------------

async function handleSuccess(deal: Deal, result: PipelineResult): Promise<void> {
  console.log("[pipeline] Deal " + deal.id + " completed successfully");

  try {
    // Build output files (Dataset D, IC Insights, Synopsis)
    const outputs: PipelineOutputs = await buildOutputFiles(deal, result);

    // Upload to Supabase Storage and send delivery email
    await uploadAndDeliver(deal, outputs);

    // Update deal status
    await updateDealStatus(deal.id, "completed");

    // Resolve payment — capture for Stripe deals, no-op for promo deals
    if (isStripeDeal(deal)) {
      await resolvePayment(deal.id, { success: true });
    }

    console.log(
      "[pipeline] Deal " + deal.id + " fully delivered — " +
        "tokens: " + (result.tokenUsage?.totalInput || 0) + "/" + (result.tokenUsage?.totalOutput || 0)
    );
  } catch (err) {
    console.error("[pipeline] Post-pipeline error for deal " + deal.id + ":", err);
    // Pipeline succeeded but delivery failed — don't charge
    await updateDealStatus(deal.id, "aborted_not_charged");
    await recordAbort(
      deal.id,
      "PIPELINE_ERR_010",
      "Output delivery failed: " + (err instanceof Error ? err.message : String(err))
    );
    if (isStripeDeal(deal)) {
      await resolvePayment(deal.id, { success: false, abortCode: "PIPELINE_ERR_010" });
    }
  }
}

async function handleFailure(deal: Deal, result: PipelineResult): Promise<void> {
  console.log(
    "[pipeline] Deal " + deal.id + " failed — " + result.abortCode + ": " + result.abortReason
  );

  await updateDealStatus(deal.id, "aborted_not_charged");

  // For Quality Gate failures, deliver the quality report as the sole output
  if (result.abortCode === "CIM_ERR_041" && result.qualityGate) {
    try {
      await deliverQualityGateReport(deal, result.qualityGate);
    } catch (err) {
      console.error("[pipeline] Failed to deliver quality gate report for deal " + deal.id + ":", err);
    }
  }

  // Resolve payment — release hold for Stripe deals
  if (isStripeDeal(deal)) {
    await resolvePayment(deal.id, {
      success: false,
      abortCode: result.abortCode,
    });
  }
}

// ---------------------------------------------------------------------------
// Quality Gate failure — deliver report only
// ---------------------------------------------------------------------------

async function deliverQualityGateReport(
  deal: Deal,
  qualityGate: Record<string, unknown>
): Promise<void> {
  const lines = [
    "# CIMScan Quality Gate Report",
    "",
    "**Deal:** " + deal.deal_name,
    "**Claim Depth:** " + deal.claim_depth,
    "**Gate Decision:** FAIL",
    "**Quality Score:** " + qualityGate.quality_score,
    "",
    "## Dimension Scores",
    "",
    "| Dimension | Score |",
    "|-----------|-------|",
    "| Financial Data Density | " + qualityGate.financial_data_density + " |",
    "| Customer & Concentration Data | " + qualityGate.customer_concentration_data + " |",
    "| Operational & Structural Detail | " + qualityGate.operational_structural_detail + " |",
    "| Growth & Pipeline Substantiation | " + qualityGate.growth_pipeline_substantiation + " |",
    "| Risk & Compliance Disclosure | " + qualityGate.risk_compliance_disclosure + " |",
    "",
    "## Quality Notes",
    "",
    String(qualityGate.quality_notes || "N/A"),
    "",
    "## Data Gaps Identified",
    "",
  ];

  if (Array.isArray(qualityGate.data_gaps_identified)) {
    (qualityGate.data_gaps_identified as string[]).forEach(function(gap) {
      lines.push("- " + gap);
    });
  } else {
    lines.push("N/A");
  }

  lines.push("");
  lines.push("---");
  lines.push("*This CIM did not meet the minimum data quality threshold for structured analysis. No charges have been applied.*");

  const synopsis = lines.join("\n");

  const storagePath = "outputs/" + deal.id + "/quality-gate-report.md";
  const { error } = await supabase.storage
    .from("outputs")
    .upload(storagePath, Buffer.from(synopsis, "utf-8"), {
      contentType: "text/markdown",
      upsert: true,
    });

  if (error) {
    throw new Error("Failed to upload quality gate report: " + error.message);
  }

  console.log("[pipeline] Quality gate report uploaded for deal " + deal.id);
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

async function fetchDeal(dealId: string): Promise<Deal> {
  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, deal_name, sender_email, firm_id, cim_storage_path, status, " +
        "claim_depth, stripe_payment_intent_id, payment_amount_cents"
    )
    .eq("id", dealId)
    .single();

  if (error || !data) {
    throw new Error("Deal not found: " + dealId + " — " + (error?.message || ""));
  }

  return data as unknown as Deal;
}

async function updateDealStatus(dealId: string, status: string): Promise<void> {
  const { error } = await supabase
    .from("deals")
    .update({ status })
    .eq("id", dealId);

  if (error) {
    console.error("[pipeline] Failed to update deal " + dealId + " status to " + status + ":", error);
  }
}

async function recordAbort(
  dealId: string,
  abortCode: string,
  abortReason: string
): Promise<void> {
  const { error } = await supabase
    .from("deals")
    .update({
      pipeline_abort_code: abortCode,
      pipeline_abort_reason: abortReason,
    })
    .eq("id", dealId);

  if (error) {
    console.error("[pipeline] Failed to record abort for deal " + dealId + ":", error);
  }
}

async function clearAbort(dealId: string): Promise<void> {
  const { error } = await supabase
    .from("deals")
    .update({
      pipeline_abort_code: null,
      pipeline_abort_reason: null,
    })
    .eq("id", dealId);

  if (error) {
    console.error("[pipeline] Failed to clear abort for deal " + dealId + ":", error);
  }
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function downloadCim(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from("cims")
    .download(storagePath);

  if (error || !data) {
    throw new Error("CIM download failed: " + (error?.message || ""));
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// JSON extraction helpers
// ---------------------------------------------------------------------------

function extractAbort(
  data: Record<string, unknown>
): { code: string; reason: string } | null {
  const abort = data.abort as Record<string, unknown> | null | undefined;
  if (abort && typeof abort === "object") {
    const code =
      (abort.code as string) ||
      (abort.error_code as string) ||
      "UNKNOWN_ABORT";
    const reason =
      (abort.reason as string) ||
      (abort.what_happened as string) ||
      (abort.description as string) ||
      "No reason provided";
    return { code, reason };
  }

  const error = data.error as Record<string, unknown> | string | undefined;
  if (error && typeof error === "object") {
    const code = (error.code as string) || "UNKNOWN_ABORT";
    const reason = (error.message as string) || (error.reason as string) || "Error in pipeline";
    return { code, reason };
  }

  return null;
}

function extractStage(
  data: Record<string, unknown>,
  stageNum: number
): Record<string, unknown> | undefined {
  // Direct stage key: "stage_2", "stage2", etc.
  var keys = ["stage_" + stageNum, "stage" + stageNum];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (data[key] && typeof data[key] === "object") {
      return data[key] as Record<string, unknown>;
    }
  }

  // Nested in a "stages" array
  if (Array.isArray(data.stages)) {
    var stages = data.stages as Record<string, unknown>[];
    for (var j = 0; j < stages.length; j++) {
      var s = stages[j];
      if (s.stage === stageNum || s.stage_number === stageNum) {
        return s;
      }
    }
  }

  // The data might be flat (all stage outputs at top level)
  if (stageNum === 2 && data.gates) return data as Record<string, unknown>;
  if (stageNum === 3 && data.tasks) return data as Record<string, unknown>;
  if (stageNum === 4 && data.matrix_pairs) return data as Record<string, unknown>;
  if (stageNum === 5 && data.pillars) return data as Record<string, unknown>;

  return undefined;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isStripeDeal(deal: Deal): boolean {
  return (deal.payment_amount_cents ?? 0) > 0 && !!deal.stripe_payment_intent_id;
}
