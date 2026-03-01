import { Router, Request, Response } from "express";
import multer from "multer";
import { simpleParser, ParsedMail } from "mailparser";
import { supabase } from "../lib/supabase.js";
import { anthropic } from "../lib/anthropic.js";

const upload = multer();
export const ingestRouter = Router();

/**
 * POST /api/email/ingest
 *
 * SendGrid Inbound Parse webhook (raw mode).
 * Receives the full MIME message in the "email" form field.
 *
 * Flow:
 *   1. Parse MIME → extract TO address, sender, PDF attachment
 *   2. Match TO address → firms.ingest_address
 *   3. Upload CIM PDF to Supabase Storage
 *   4. Create deal (stage 0 = received)
 *   5. Create run (stage 0 = received)
 *   6. Return 200 immediately
 *   7. Async: send PDF to Anthropic, store result, update run
 *
 * Stages: 0 = received, 1 = processing, 2 = complete
 */
ingestRouter.post("/", upload.none(), async (req: Request, res: Response) => {
  const rawEmail: string | undefined = req.body?.email;

  if (!rawEmail) {
    console.error("[ingest] No 'email' field in payload");
    res.status(400).json({ error: "Missing email field" });
    return;
  }

  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(rawEmail);
  } catch (err) {
    console.error("[ingest] MIME parse failed:", err);
    res.status(400).json({ error: "Failed to parse email" });
    return;
  }

  // --- Extract TO address (the firm's ingest address) ---
  const toAddress =
    parsed.to &&
    !Array.isArray(parsed.to) &&
    parsed.to.value?.[0]?.address?.toLowerCase();

  if (!toAddress) {
    console.error("[ingest] Could not extract TO address");
    res.status(400).json({ error: "No TO address" });
    return;
  }

  // --- Extract sender ---
  const senderAddress =
    parsed.from?.value?.[0]?.address?.toLowerCase() ?? "unknown";

  // --- Find PDF attachment ---
  const pdfAttachment = parsed.attachments?.find(
    (a) => a.contentType === "application/pdf"
  );

  if (!pdfAttachment) {
    console.error(`[ingest] No PDF attachment from ${senderAddress}`);
    res.status(400).json({ error: "No PDF attachment found" });
    return;
  }

  // --- Match TO address to firm ---
  const { data: firm } = await supabase
    .from("firms")
    .select("id, name")
    .eq("ingest_address", toAddress)
    .limit(1)
    .maybeSingle();

  if (!firm) {
    console.warn(`[ingest] No firm matched for ingest address: ${toAddress}`);
    res.status(200).json({ warning: "No matching firm found", to: toAddress });
    return;
  }

  // --- Upload CIM PDF to Supabase Storage ---
  const timestamp = Date.now();
  const safeFilename =
    pdfAttachment.filename?.replace(/[^a-zA-Z0-9._-]/g, "_") ?? "cim.pdf";
  const storagePath = `${firm.id}/${timestamp}_${safeFilename}`;

  const { error: uploadError } = await supabase.storage
    .from("cims")
    .upload(storagePath, pdfAttachment.content, {
      contentType: "application/pdf",
    });

  if (uploadError) {
    console.error("[ingest] PDF upload failed:", uploadError);
    res.status(500).json({ error: "Failed to upload PDF" });
    return;
  }

  // --- Create deal ---
  const dealName =
    parsed.subject ?? pdfAttachment.filename ?? "Untitled CIM";

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .insert({
      firm_id: firm.id,
      deal_name: dealName,
      sender_email: senderAddress,
      cim_storage_path: storagePath,
      status: "received",
    })
    .select("id")
    .single();

  if (dealError || !deal) {
    console.error("[ingest] Failed to create deal:", dealError);
    res.status(500).json({ error: "Failed to create deal" });
    return;
  }

  // --- Create run ---
  const { data: run, error: runError } = await supabase
    .from("runs")
    .insert({
      deal_id: deal.id,
      stage_reached: 0,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runError || !run) {
    console.error("[ingest] Failed to create run:", runError);
    res.status(500).json({ error: "Failed to create run" });
    return;
  }

  console.log(
    `[ingest] Deal ${deal.id} / Run ${run.id} for firm "${firm.name}" from ${senderAddress}`
  );

  // --- Return 200 immediately, process async ---
  res.status(200).json({
    deal_id: deal.id,
    run_id: run.id,
    firm: firm.name,
    filename: safeFilename,
  });

  // Fire-and-forget: kick off EC-CIM pipeline
  processAsync(run.id, deal.id, firm.id, pdfAttachment.content, senderAddress).catch(
    (err) =>
      console.error(`[ingest] Async processing failed for run ${run.id}:`, err)
  );
});

// ─── Async Pipeline ─────────────────────────────────────────────────────────

async function processAsync(
  runId: string,
  dealId: string,
  firmId: string,
  pdfBuffer: Buffer,
  senderEmail: string
): Promise<void> {
  // Stage 1 = processing
  await supabase
    .from("runs")
    .update({ stage_reached: 1 })
    .eq("id", runId);

  try {
    const pdfBase64 = pdfBuffer.toString("base64");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: `You are EC-CIM, an AI analyst that performs due diligence on Confidential Information Memorandums (CIMs). Analyze the attached CIM and return a structured JSON report with the following sections:

{
  "company_name": "string",
  "industry": "string",
  "summary": "Brief executive summary",
  "financials": {
    "revenue": "string or null",
    "ebitda": "string or null",
    "margins": "string or null",
    "growth_rate": "string or null"
  },
  "strengths": ["array of key strengths"],
  "risks": ["array of key risks and concerns"],
  "questions": ["follow-up diligence questions an analyst should ask"]
}

Return ONLY valid JSON. No markdown, no commentary.`,
            },
          ],
        },
      ],
    });

    // Extract text response
    const textBlock = response.content.find((b) => b.type === "text");
    const resultText = textBlock
      ? (textBlock as { type: "text"; text: string }).text
      : null;

    // Store output JSON in Supabase Storage
    const outputPath = `${firmId}/${dealId}/run_${runId}.json`;

    const { error: outputUploadError } = await supabase.storage
      .from("outputs")
      .upload(outputPath, resultText ?? "{}", {
        contentType: "application/json",
      });

    if (outputUploadError) {
      throw new Error(`Output upload failed: ${outputUploadError.message}`);
    }

    // Stage 2 = complete
    await supabase
      .from("runs")
      .update({
        stage_reached: 2,
        output_storage_path: outputPath,
        tokens_input: response.usage?.input_tokens ?? null,
        tokens_output: response.usage?.output_tokens ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    // Update deal status
    await supabase
      .from("deals")
      .update({ status: "complete" })
      .eq("id", dealId);

    console.log(`[ingest] Run ${runId} complete → ${outputPath}`);

    // TODO: Send result email back to senderEmail

  } catch (err) {
    console.error(`[ingest] Pipeline error for run ${runId}:`, err);

    await supabase
      .from("runs")
      .update({
        abort_code: "pipeline_error",
        error_detail: {
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        },
      })
      .eq("id", runId);

    await supabase
      .from("deals")
      .update({ status: "failed" })
      .eq("id", dealId);
  }
}
