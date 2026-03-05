/**
 * Pipeline Service — EC-CIM Sequential Stage Execution
 *
 * Each stage uses the specific run command from the EC-CIM prompt spec,
 * matching how manual chat runs operate for maximum output quality.
 *
 * Pass 1: CIM PDF -> Quality Gate + Stage 1 (claim register)
 * Stage 2: Underwriting Gates (one per claim)
 * Stage 3: Workstream Execution (tasks per claim)
 * Stage 4: Interdependency Analysis (matrix, hubs, cascades, coupling, kill hubs)
 * Stage 5: Thesis Pillars + Export Validation
 */

import { supabase } from "../lib/supabase.js";
import {
  executePass1,
  executeStage2,
  executeStage3,
  executeStage4,
  executeStage5,
  executeIcInsights,
  PipelinePassResult,
} from "../lib/anthropic.js";
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
  var deal: Deal;

  try {
    deal = await fetchDeal(dealId);
  } catch (err) {
    console.error("[pipeline] Failed to fetch deal " + dealId + ":", err);
    return;
  }

  if (deal.status !== "pipeline_queued" && deal.status !== "received") {
    console.warn(
      "[pipeline] Deal " + dealId + " is in status '" + deal.status + "', expected 'pipeline_queued'. Skipping."
    );
    return;
  }

  await updateDealStatus(dealId, "pipeline_running");

  console.log(
    "[pipeline] Starting pipeline for deal " + dealId + " (" + deal.deal_name + ") — " + deal.claim_depth + " depth"
  );

  var result = await runPipeline(deal);

  if (!result.success && result.abortCode) {
    console.warn(
      "[pipeline] Deal " + dealId + " aborted on first attempt: " + result.abortCode + " — " + result.abortReason
    );

    await recordAbort(dealId, result.abortCode, result.abortReason || "");

    if (shouldRetry(result.abortCode)) {
      console.log("[pipeline] Retrying deal " + dealId + " (abort code " + result.abortCode + " is retryable)");
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

  if (result.success) {
    await handleSuccess(deal, result);
  } else {
    await handleFailure(deal, result);
  }
}

export function triggerPipeline(dealId: string): void {
  executePipeline(dealId).catch(function(err) {
    console.error("[pipeline] Unhandled error for deal " + dealId + ":", err);
    updateDealStatus(dealId, "aborted_not_charged").catch(function() {});
  });
}

// ---------------------------------------------------------------------------
// Pipeline execution — sequential per-stage with specific run commands
// ---------------------------------------------------------------------------

async function runPipeline(deal: Deal): Promise<PipelineResult> {
  var totalInput = 0;
  var totalOutput = 0;

  // ---- Download CIM PDF ----
  var pdfBuffer: Buffer;
  try {
    pdfBuffer = await downloadCim(deal.cim_storage_path);
  } catch (err) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_001",
      abortReason: "Failed to download CIM: " + (err instanceof Error ? err.message : String(err)),
    };
  }

  var sourceFilename = deal.cim_storage_path.split("/").pop() || "CIM.pdf";

  // ==== PASS 1: CIM PDF -> Quality Gate + Stage 1 ====

  var pass1: PipelinePassResult;
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

  if (pass1.truncated) {
    return { success: false, abortCode: "PIPELINE_ERR_003", abortReason: "Pass 1 response truncated" };
  }
  if (!pass1.json) {
    return { success: false, abortCode: "PIPELINE_ERR_004", abortReason: "Pass 1 returned no parseable JSON" };
  }

  var pass1Data = pass1.json as Record<string, unknown>;
  console.log("[pipeline] Pass 1 top-level keys: " + Object.keys(pass1Data).join(", "));

  var pass1Abort = extractAbort(pass1Data);
  if (pass1Abort) {
    return {
      success: false,
      abortCode: pass1Abort.code,
      abortReason: pass1Abort.reason,
      qualityGate: pass1Data.cim_quality_gate as Record<string, unknown> | undefined,
    };
  }

  var qualityGate = pass1Data.cim_quality_gate as Record<string, unknown> | undefined;
  var gateDecision = qualityGate?.gate_decision as string | undefined;

  if (gateDecision === "FAIL") {
    return {
      success: false,
      abortCode: "CIM_ERR_041",
      abortReason: "CIM Quality Gate FAIL — score: " + qualityGate?.quality_score,
      qualityGate: qualityGate,
    };
  }

  var claimCount = (pass1Data.claims as unknown[])?.length || 0;
  console.log(
    "[pipeline] Pass 1 complete — " + claimCount + " claims, gate: " + gateDecision +
    ", tokens: " + pass1.inputTokens + "/" + pass1.outputTokens
  );

  // ==== STAGE 2: Underwriting Gates ====

  console.log("[pipeline] Running Stage 2 (Underwriting Gates)");
  var stage2Result: PipelinePassResult;
  try {
    stage2Result = await executeStage2(pass1Data, deal.claim_depth);
    totalInput += stage2Result.inputTokens;
    totalOutput += stage2Result.outputTokens;
  } catch (err) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_005",
      abortReason: "Stage 2 API call failed: " + (err instanceof Error ? err.message : String(err)),
      qualityGate: qualityGate,
      stage1: pass1Data,
    };
  }

  if (stage2Result.truncated) {
    return { success: false, abortCode: "PIPELINE_ERR_006", abortReason: "Stage 2 response truncated", qualityGate: qualityGate, stage1: pass1Data };
  }
  if (!stage2Result.json) {
    return { success: false, abortCode: "PIPELINE_ERR_007", abortReason: "Stage 2 returned no parseable JSON", qualityGate: qualityGate, stage1: pass1Data };
  }

  var stage2Data = stage2Result.json as Record<string, unknown>;
  var stage2Abort = extractAbort(stage2Data);
  if (stage2Abort) {
    return { success: false, abortCode: stage2Abort.code, abortReason: stage2Abort.reason, qualityGate: qualityGate, stage1: pass1Data };
  }

  console.log(
    "[pipeline] Stage 2 complete — keys: " + Object.keys(stage2Data).join(", ") +
    ", tokens: " + stage2Result.inputTokens + "/" + stage2Result.outputTokens
  );

  // Build accumulated context for Stage 3
  var context2: Record<string, unknown> = {
    cim_quality_gate: pass1Data.cim_quality_gate,
    claims: pass1Data.claims,
    self_audit: pass1Data.self_audit,
    claim_depth: pass1Data.claim_depth,
    ec_cim_version: pass1Data.ec_cim_version,
    stage_2: stage2Data,
  };

  // ==== STAGE 3: Workstream Execution ====

  console.log("[pipeline] Running Stage 3 (Workstream Execution)");
  var stage3Result: PipelinePassResult;
  try {
    stage3Result = await executeStage3(context2, deal.claim_depth);
    totalInput += stage3Result.inputTokens;
    totalOutput += stage3Result.outputTokens;
  } catch (err) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_005",
      abortReason: "Stage 3 API call failed: " + (err instanceof Error ? err.message : String(err)),
      qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data,
    };
  }

  if (stage3Result.truncated) {
    return { success: false, abortCode: "PIPELINE_ERR_006", abortReason: "Stage 3 response truncated", qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data };
  }
  if (!stage3Result.json) {
    return { success: false, abortCode: "PIPELINE_ERR_007", abortReason: "Stage 3 returned no parseable JSON", qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data };
  }

  var stage3Data = stage3Result.json as Record<string, unknown>;
  var stage3Abort = extractAbort(stage3Data);
  if (stage3Abort) {
    return { success: false, abortCode: stage3Abort.code, abortReason: stage3Abort.reason, qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data };
  }

  console.log(
    "[pipeline] Stage 3 complete — keys: " + Object.keys(stage3Data).join(", ") +
    ", tokens: " + stage3Result.inputTokens + "/" + stage3Result.outputTokens
  );

  // Build accumulated context for Stage 4
  var context3 = Object.assign({}, context2, { stage_3: stage3Data });

  // ==== STAGE 4: Interdependency Analysis ====

  console.log("[pipeline] Running Stage 4 (Interdependency Analysis)");
  var stage4Result: PipelinePassResult;
  try {
    stage4Result = await executeStage4(context3, deal.claim_depth);
    totalInput += stage4Result.inputTokens;
    totalOutput += stage4Result.outputTokens;
  } catch (err) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_005",
      abortReason: "Stage 4 API call failed: " + (err instanceof Error ? err.message : String(err)),
      qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data, stage3: stage3Data,
    };
  }

  if (stage4Result.truncated) {
    return { success: false, abortCode: "PIPELINE_ERR_006", abortReason: "Stage 4 response truncated", qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data, stage3: stage3Data };
  }
  if (!stage4Result.json) {
    return { success: false, abortCode: "PIPELINE_ERR_007", abortReason: "Stage 4 returned no parseable JSON", qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data, stage3: stage3Data };
  }

  var stage4Data = stage4Result.json as Record<string, unknown>;
  var stage4Abort = extractAbort(stage4Data);
  if (stage4Abort) {
    return { success: false, abortCode: stage4Abort.code, abortReason: stage4Abort.reason, qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data, stage3: stage3Data };
  }

  console.log(
    "[pipeline] Stage 4 complete — keys: " + Object.keys(stage4Data).join(", ") +
    ", tokens: " + stage4Result.inputTokens + "/" + stage4Result.outputTokens
  );

  // Build accumulated context for Stage 5
  var context4 = Object.assign({}, context3, { stage_4: stage4Data });

  // ==== STAGE 5: Thesis Pillars + Export Validation ====

  console.log("[pipeline] Running Stage 5 + IC Insights");
  var stage5Result: PipelinePassResult;
  try {
    stage5Result = await executeStage5(context4, deal.claim_depth);
    totalInput += stage5Result.inputTokens;
    totalOutput += stage5Result.outputTokens;
  } catch (err) {
    return {
      success: false,
      abortCode: "PIPELINE_ERR_005",
      abortReason: "Stage 5 API call failed: " + (err instanceof Error ? err.message : String(err)),
      qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data, stage3: stage3Data, stage4: stage4Data,
    };
  }

  if (stage5Result.truncated) {
    return { success: false, abortCode: "PIPELINE_ERR_006", abortReason: "Stage 5 response truncated", qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data, stage3: stage3Data, stage4: stage4Data };
  }
  if (!stage5Result.json) {
    return { success: false, abortCode: "PIPELINE_ERR_007", abortReason: "Stage 5 returned no parseable JSON", qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data, stage3: stage3Data, stage4: stage4Data };
  }

  var stage5Data = stage5Result.json as Record<string, unknown>;
  var stage5Abort = extractAbort(stage5Data);
  if (stage5Abort) {
    return { success: false, abortCode: stage5Abort.code, abortReason: stage5Abort.reason, qualityGate: qualityGate, stage1: pass1Data, stage2: stage2Data, stage3: stage3Data, stage4: stage4Data };
  }

  console.log(
    "[pipeline] Stage 5 complete — keys: " + Object.keys(stage5Data).join(", ") +
    ", tokens: " + stage5Result.inputTokens + "/" + stage5Result.outputTokens
  );

  // Build full context for IC Insights
  var context5 = Object.assign({}, context4, { stage_5: stage5Data });

  // ==== IC INSIGHTS: Narrative synthesis ====

  console.log("[pipeline] Running IC Insights (narrative synthesis)");
  var icInsightsResult: PipelinePassResult;
  try {
    icInsightsResult = await executeIcInsights(context5, deal.claim_depth);
    totalInput += icInsightsResult.inputTokens;
    totalOutput += icInsightsResult.outputTokens;
  } catch (err) {
    // IC Insights failure is non-fatal — we still have all stage data
    console.error("[pipeline] IC Insights API call failed (non-fatal): " + (err instanceof Error ? err.message : String(err)));
    icInsightsResult = { rawText: "", json: null, inputTokens: 0, outputTokens: 0, stopReason: null, truncated: false };
  }

  var icInsightsData: Record<string, unknown> | null = null;
  if (icInsightsResult.json) {
    icInsightsData = icInsightsResult.json as Record<string, unknown>;
    console.log(
      "[pipeline] IC Insights complete — keys: " + Object.keys(icInsightsData).join(", ") +
      ", tokens: " + icInsightsResult.inputTokens + "/" + icInsightsResult.outputTokens
    );
  } else {
    console.warn("[pipeline] IC Insights returned no parseable JSON — will use fallback in output builder");
  }

  // ---- Assemble result ----
  return {
    success: true,
    qualityGate: qualityGate,
    stage1: pass1Data,
    stage2: stage2Data,
    stage3: stage3Data,
    stage4: stage4Data,
    stage5: stage5Data,
    icInsights: icInsightsData || undefined,
    synopsis: (stage5Data.synopsis as string) || (stage5Data.workstream_synopsis as string) || undefined,
    tokenUsage: { totalInput: totalInput, totalOutput: totalOutput },
  };
}

// ---------------------------------------------------------------------------
// Success / failure handlers
// ---------------------------------------------------------------------------

async function handleSuccess(deal: Deal, result: PipelineResult): Promise<void> {
  console.log("[pipeline] Deal " + deal.id + " completed successfully");

  try {
    var outputs: PipelineOutputs = await buildOutputFiles(deal, result);
    await uploadAndDeliver(deal, outputs);
    await updateDealStatus(deal.id, "completed");

    if (isStripeDeal(deal)) {
      await resolvePayment(deal.id, { success: true });
    }

    console.log(
      "[pipeline] Deal " + deal.id + " fully delivered — " +
      "tokens: " + (result.tokenUsage?.totalInput || 0) + "/" + (result.tokenUsage?.totalOutput || 0)
    );
  } catch (err) {
    console.error("[pipeline] Post-pipeline error for deal " + deal.id + ":", err);
    await updateDealStatus(deal.id, "aborted_not_charged");
    await recordAbort(deal.id, "PIPELINE_ERR_010",
      "Output delivery failed: " + (err instanceof Error ? err.message : String(err))
    );
    if (isStripeDeal(deal)) {
      await resolvePayment(deal.id, { success: false, abortCode: "PIPELINE_ERR_010" });
    }
  }
}

async function handleFailure(deal: Deal, result: PipelineResult): Promise<void> {
  console.log("[pipeline] Deal " + deal.id + " failed — " + result.abortCode + ": " + result.abortReason);

  await updateDealStatus(deal.id, "aborted_not_charged");

  if (result.abortCode === "CIM_ERR_041" && result.qualityGate) {
    try {
      await deliverQualityGateReport(deal, result.qualityGate);
    } catch (err) {
      console.error("[pipeline] Failed to deliver quality gate report for deal " + deal.id + ":", err);
    }
  }

  if (isStripeDeal(deal)) {
    await resolvePayment(deal.id, { success: false, abortCode: result.abortCode });
  }
}

// ---------------------------------------------------------------------------
// Quality Gate failure report
// ---------------------------------------------------------------------------

async function deliverQualityGateReport(deal: Deal, qualityGate: Record<string, unknown>): Promise<void> {
  var lines = [
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

  lines.push("", "---", "*This CIM did not meet the minimum data quality threshold. No charges applied.*");

  var storagePath = "outputs/" + deal.id + "/quality-gate-report.md";
  var uploadResult = await supabase.storage.from("outputs").upload(
    storagePath, Buffer.from(lines.join("\n"), "utf-8"),
    { contentType: "text/markdown", upsert: true }
  );

  if (uploadResult.error) {
    throw new Error("Failed to upload quality gate report: " + uploadResult.error.message);
  }

  console.log("[pipeline] Quality gate report uploaded for deal " + deal.id);
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

async function fetchDeal(dealId: string): Promise<Deal> {
  var result = await supabase.from("deals")
    .select("id, deal_name, sender_email, firm_id, cim_storage_path, status, claim_depth, stripe_payment_intent_id, payment_amount_cents")
    .eq("id", dealId).single();

  if (result.error || !result.data) {
    throw new Error("Deal not found: " + dealId + " — " + (result.error?.message || ""));
  }
  return result.data as unknown as Deal;
}

async function updateDealStatus(dealId: string, status: string): Promise<void> {
  var result = await supabase.from("deals").update({ status: status }).eq("id", dealId);
  if (result.error) {
    console.error("[pipeline] Failed to update deal " + dealId + " status to " + status + ":", result.error);
  }
}

async function recordAbort(dealId: string, abortCode: string, abortReason: string): Promise<void> {
  var result = await supabase.from("deals").update({ pipeline_abort_code: abortCode, pipeline_abort_reason: abortReason }).eq("id", dealId);
  if (result.error) {
    console.error("[pipeline] Failed to record abort for deal " + dealId + ":", result.error);
  }
}

async function clearAbort(dealId: string): Promise<void> {
  var result = await supabase.from("deals").update({ pipeline_abort_code: null, pipeline_abort_reason: null }).eq("id", dealId);
  if (result.error) {
    console.error("[pipeline] Failed to clear abort for deal " + dealId + ":", result.error);
  }
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function downloadCim(storagePath: string): Promise<Buffer> {
  var result = await supabase.storage.from("cims").download(storagePath);
  if (result.error || !result.data) {
    throw new Error("CIM download failed: " + (result.error?.message || ""));
  }
  var arrayBuffer = await result.data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// JSON extraction helpers
// ---------------------------------------------------------------------------

function extractAbort(data: Record<string, unknown>): { code: string; reason: string } | null {
  var abort = data.abort as Record<string, unknown> | null | undefined;
  if (abort && typeof abort === "object") {
    return {
      code: (abort.code as string) || (abort.error_code as string) || "UNKNOWN_ABORT",
      reason: (abort.reason as string) || (abort.what_happened as string) || (abort.description as string) || "No reason provided",
    };
  }

  var errorObj = data.error as Record<string, unknown> | string | undefined;
  if (errorObj && typeof errorObj === "object") {
    return {
      code: (errorObj.code as string) || "UNKNOWN_ABORT",
      reason: (errorObj.message as string) || (errorObj.reason as string) || "Error in pipeline",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isStripeDeal(deal: Deal): boolean {
  return (deal.payment_amount_cents ?? 0) > 0 && !!deal.stripe_payment_intent_id;
}
