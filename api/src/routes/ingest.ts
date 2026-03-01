import { Router, Request, Response } from "express";
import multer from "multer";
import { simpleParser, ParsedMail } from "mailparser";
import { supabase } from "../lib/supabase.js";
import { anthropic } from "../lib/anthropic.js";

const upload = multer(); // in-memory, no file storage needed
export const ingestRouter = Router();

/**
 * POST /api/email/ingest
 *
 * SendGrid Inbound Parse webhook (raw mode).
 * Receives the full MIME message in the "email" form field.
 * Extracts the sender + PDF attachment, matches to a firm,
 * creates a deal & run, returns 200, then processes async.
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

  // --- Extract sender ---
  const senderAddress =
    parsed.from?.value?.[0]?.address?.toLowerCase() ?? null;
  const senderName = parsed.from?.value?.[0]?.name ?? null;

  if (!senderAddress) {
    console.error("[ingest] Could not extract sender address");
    res.status(400).json({ error: "No sender address" });
    return;
  }

  // --- Find PDF attachment ---
  const pdfAttachment = parsed.attachments?.find(
    (a) => a.contentType === "application/pdf"
  );

  if (!pdfAttachment) {
    console.error(`[ingest] No PDF attachment from ${senderAddress}`);
    res.status(400).json({ error: "No PDF attachment found" });
    return;
  }

  // --- Match sender to firm ---
  const senderDomain = senderAddress.split("@")[1];

  const { data: firm } = await supabase
    .from("firms")
    .select("id, name")
    .or(`email.eq.${senderAddress},domain.eq.${senderDomain}`)
    .limit(1)
    .maybeSingle();

  if (!firm) {
    console.warn(
      `[ingest] No firm matched for ${senderAddress} (${senderDomain})`
    );
    // Still return 200 so SendGrid doesn't retry, but log it
    res.status(200).json({ warning: "No matching firm found", sender: senderAddress });
    return;
  }

  // --- Create deal ---
  const dealName =
    parsed.subject ?? pdfAttachment.filename ?? "Untitled CIM";

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .insert({
      firm_id: firm.id,
      name: dealName,
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
      status: "pending",
    })
    .select("id")
    .single();

  if (runError || !run) {
    console.error("[ingest] Failed to create run:", runError);
    res.status(500).json({ error: "Failed to create run" });
    return;
  }

  console.log(
    `[ingest] Created deal ${deal.id} / run ${run.id} for firm ${firm.name} (${senderAddress})`
  );

  // --- Return 200 immediately, process async ---
  res.status(200).json({
    deal_id: deal.id,
    run_id: run.id,
    firm: firm.name,
    filename: pdfAttachment.filename,
  });

  // Fire-and-forget: kick off EC-CIM pipeline
  processAsync(run.id, deal.id, pdfAttachment.content).catch((err) =>
    console.error(`[ingest] Async processing failed for run ${run.id}:`, err)
  );
});

// ─── Async Pipeline ─────────────────────────────────────────────────────────

async function processAsync(
  runId: string,
  dealId: string,
  pdfBuffer: Buffer
): Promise<void> {
  // Mark run as processing
  await supabase
    .from("runs")
    .update({ status: "processing" })
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
    const result = textBlock ? (textBlock as { type: "text"; text: string }).text : null;

    // Store result
    await supabase
      .from("runs")
      .update({
        status: "complete",
        result: result ? JSON.parse(result) : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    console.log(`[ingest] Run ${runId} complete`);
  } catch (err) {
    console.error(`[ingest] Pipeline error for run ${runId}:`, err);

    await supabase
      .from("runs")
      .update({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      })
      .eq("id", runId);
  }
}
