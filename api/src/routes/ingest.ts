import { Router, Request, Response } from "express";
import multer from "multer";
import { supabase } from "../lib/supabase.js";
import { anthropic } from "../lib/anthropic.js";

// Multer stores file uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

export const ingestRouter = Router();

/**
 * POST /api/email/ingest
 *
 * Mailgun inbound route webhook.
 * Receives multipart form data with parsed fields and attachments.
 *
 * Mailgun fields:
 *   - sender: sender email address
 *   - recipient: the TO address
 *   - subject: email subject
 *   - body-plain: plain text body
 *   - attachment-1, attachment-2, etc: file uploads
 *
 * Flow:
 *   1. Extract recipient (TO), sender, PDF attachment
 *   2. Match TO address → firms.ingest_address
 *   3. Upload CIM PDF to Supabase Storage
 *   4. Create deal + run
 *   5. Return 200 immediately
 *   6. Async: send PDF to Anthropic, store result
 *
 * Stages: 0 = received, 1 = processing, 2 = complete
 */
ingestRouter.post(
  "/",
  upload.any(),
  async (req: Request, res: Response) => {
    console.log("[ingest] Received webhook from Mailgun");

    // --- Extract fields ---
    const recipient: string | undefined =
      req.body?.recipient?.toLowerCase();
    const sender: string | undefined =
      req.body?.sender?.toLowerCase() ?? req.body?.from?.toLowerCase();
    const subject: string | undefined = req.body?.subject;

    console.log(
      `[ingest] From: ${sender}, To: ${recipient}, Subject: ${subject}`
    );

    if (!recipient) {
      console.error("[ingest] No recipient in payload");
      res.status(400).json({ error: "No recipient" });
      return;
    }

    if (!sender) {
      console.error("[ingest] No sender in payload");
      res.status(400).json({ error: "No sender" });
      return;
    }

    // --- Find PDF attachment ---
    const files = req.files as Express.Multer.File[] | undefined;
    const pdfFile = files?.find(
      (f) =>
        f.mimetype === "application/pdf" ||
        f.originalname?.toLowerCase().endsWith(".pdf")
    );

    if (!pdfFile) {
      console.error(`[ingest] No PDF attachment from ${sender}`);
      res.status(200).json({ warning: "No PDF attachment found" });
      return;
    }

    console.log(
      `[ingest] PDF found: ${pdfFile.originalname} (${pdfFile.size} bytes)`
    );

    // --- Match recipient to firm ---
    const { data: firm } = await supabase
      .from("firms")
      .select("id, name")
      .eq("ingest_address", recipient)
      .limit(1)
      .maybeSingle();

    if (!firm) {
      console.warn(
        `[ingest] No firm matched for ingest address: ${recipient}`
      );
      res
        .status(200)
        .json({ warning: "No matching firm found", to: recipient });
      return;
    }

    // --- Upload CIM PDF to Supabase Storage ---
    const timestamp = Date.now();
    const safeFilename =
      pdfFile.originalname?.replace(/[^a-zA-Z0-9._-]/g, "_") ?? "cim.pdf";
    const storagePath = `${firm.id}/${timestamp}_${safeFilename}`;

    const { error: uploadError } = await supabase.storage
      .from("cims")
      .upload(storagePath, pdfFile.buffer, {
        contentType: "application/pdf",
      });

    if (uploadError) {
      console.error("[ingest] PDF upload failed:", uploadError);
      res.status(500).json({ error: "Failed to upload PDF" });
      return;
    }

    // --- Create deal ---
    const dealName = subject ?? pdfFile.originalname ?? "Untitled CIM";

    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .insert({
        firm_id: firm.id,
        deal_name: dealName,
        sender_email: sender,
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
      `[ingest] Deal ${deal.id} / Run ${run.id} for firm "${firm.name}" from ${sender}`
    );

    // --- Return 200 immediately, process async ---
    res.status(200).json({
      deal_id: deal.id,
      run_id: run.id,
      firm: firm.name,
      filename: safeFilename,
    });

    // Fire-and-forget: kick off EC-CIM pipeline
    processAsync(
      run.id,
      deal.id,
      firm.id,
      pdfFile.buffer,
      sender
    ).catch((err) =>
      console.error(
        `[ingest] Async processing failed for run ${run.id}:`,
        err
      )
    );
  }
);

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
