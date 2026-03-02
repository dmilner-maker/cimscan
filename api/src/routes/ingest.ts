import { Router, Request, Response } from "express";
import multer from "multer";
import { supabase } from "../lib/supabase.js";
import { sendEmail } from "../lib/mailgun.js";

// Multer stores file uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

const WEB_URL = process.env.WEB_URL ?? "https://web-production-4a3e0.up.railway.app";

export const ingestRouter = Router();

/**
 * POST /api/email/ingest
 *
 * Mailgun inbound route webhook.
 * Receives multipart form data with parsed fields and attachments.
 *
 * Flow:
 *   1. Extract recipient (TO), sender, PDF attachment
 *   2. Match TO address → firms.ingest_address
 *   3. Upload CIM PDF to Supabase Storage
 *   4. Create deal (status: received)
 *   5. Send acknowledgment email with Configure Analysis link
 *   6. Return 200
 *
 * No pipeline is triggered on receipt. Pipeline runs after
 * the user configures analysis depth, accepts terms, and pays.
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

    // --- Create deal (no run — pipeline runs after config + payment) ---
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

    console.log(
      `[ingest] Deal ${deal.id} created for firm "${firm.name}" from ${sender}`
    );

    // --- Send acknowledgment email ---
    const configureUrl = `${WEB_URL}/deals/${deal.id}/configure`;

    try {
      await sendEmail({
        to: sender,
        subject: `CIMScan: ${dealName} — Received`,
        html: buildAcknowledgmentEmail({
          dealName,
          filename: safeFilename,
          firmName: firm.name,
          configureUrl,
        }),
      });
      console.log(`[ingest] Acknowledgment email sent to ${sender}`);
    } catch (emailErr) {
      // Log but don't fail the request — deal is already created
      console.error("[ingest] Failed to send acknowledgment email:", emailErr);
    }

    // --- Return 200 ---
    res.status(200).json({
      deal_id: deal.id,
      firm: firm.name,
      filename: safeFilename,
      status: "received",
    });
  }
);

// ─── Acknowledgment Email Template ──────────────────────────────────────────

function buildAcknowledgmentEmail(params: {
  dealName: string;
  filename: string;
  firmName: string;
  configureUrl: string;
}): string {
  const { dealName, filename, firmName, configureUrl } = params;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px 40px;">
              <h1 style="margin:0 0 8px 0; font-size:20px; font-weight:600; color:#18181b;">
                CIM Received
              </h1>
              <p style="margin:0; font-size:14px; color:#71717a;">
                Your document is ready to configure for analysis.
              </p>
            </td>
          </tr>

          <!-- Detail Card -->
          <tr>
            <td style="padding:0 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafa; border:1px solid #e4e4e7; border-radius:6px;">
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:4px 0; font-size:13px; color:#71717a; width:100px;">Deal</td>
                        <td style="padding:4px 0; font-size:13px; color:#18181b; font-weight:500;">${dealName}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0; font-size:13px; color:#71717a;">File</td>
                        <td style="padding:4px 0; font-size:13px; color:#18181b; font-weight:500;">${filename}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0; font-size:13px; color:#71717a;">Firm</td>
                        <td style="padding:4px 0; font-size:13px; color:#18181b; font-weight:500;">${firmName}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0; font-size:13px; color:#71717a;">Status</td>
                        <td style="padding:4px 0; font-size:13px; color:#18181b; font-weight:500;">Received — Awaiting Configuration</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:28px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#18181b; border-radius:6px;">
                    <a href="${configureUrl}"
                       style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none;">
                      Configure Analysis
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 32px 40px; border-top:1px solid #e4e4e7;">
              <p style="margin:0; font-size:12px; color:#a1a1aa;">
                CIMScan by True Bearing LLC · IC Sentinel Product Group
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}