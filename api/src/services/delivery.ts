/**
 * Delivery Service — Upload Pipeline Outputs & Send Completion Email
 *
 * Handles:
 *   1. Upload Dataset D, IC Insights, and Synopsis to Supabase Storage
 *   2. Generate signed download URLs (7-day expiry)
 *   3. Send completion email via Resend with inline synopsis + download links
 *
 * Storage structure: outputs/{deal_id}/{filename}
 * Signed URLs are not guessable and expire after 7 days.
 */

import { supabase } from "../lib/supabase";
import { Resend } from "resend";
import { PipelineOutputs } from "./outputBuilder";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SIGNED_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "CIMScan <noreply@cimscan.ai>";

const resend = new Resend(process.env.RESEND_API_KEY);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Deal {
  id: string;
  deal_name: string;
  claim_depth: "CORE" | "FULL";
  sender_email: string;
  firm_id: string;
}

interface UploadedFile {
  storagePath: string;
  signedUrl: string;
  filename: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload all pipeline outputs and send the delivery email.
 */
export async function uploadAndDeliver(
  deal: Deal,
  outputs: PipelineOutputs
): Promise<void> {
  // Upload files to Supabase Storage
  const [datasetD, icInsights, synopsis] = await Promise.all([
    uploadFile(deal.id, outputs.datasetDFilename, outputs.datasetD, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    uploadFile(deal.id, outputs.icInsightsFilename, outputs.icInsights, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    uploadFile(deal.id, outputs.synopsisFilename, Buffer.from(outputs.synopsis, "utf-8"), "text/markdown"),
  ]);

  // Generate signed download URLs
  const [datasetDUrl, icInsightsUrl, synopsisUrl] = await Promise.all([
    getSignedUrl(datasetD.storagePath),
    getSignedUrl(icInsights.storagePath),
    getSignedUrl(synopsis.storagePath),
  ]);

  // Store output paths on the deal for future reference
  await supabase
    .from("deals")
    .update({
      output_dataset_d_path: datasetD.storagePath,
      output_ic_insights_path: icInsights.storagePath,
      output_synopsis_path: synopsis.storagePath,
    })
    .eq("id", deal.id);

  // Send delivery email
  await sendDeliveryEmail(deal, outputs, {
    datasetDUrl,
    icInsightsUrl,
    synopsisUrl,
  });

  console.log(`[delivery] All outputs uploaded and email sent for deal ${deal.id}`);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function uploadFile(
  dealId: string,
  filename: string,
  content: Buffer,
  contentType: string
): Promise<UploadedFile> {
  const storagePath = `${dealId}/${filename}`;

  const { error } = await supabase.storage
    .from("outputs")
    .upload(storagePath, content, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload ${filename}: ${error.message}`);
  }

  return { storagePath, signedUrl: "", filename };
}

async function getSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("outputs")
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed URL for ${storagePath}: ${error?.message}`);
  }

  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

interface DownloadUrls {
  datasetDUrl: string;
  icInsightsUrl: string;
  synopsisUrl: string;
}

async function sendDeliveryEmail(
  deal: Deal,
  outputs: PipelineOutputs,
  urls: DownloadUrls
): Promise<void> {
  // Truncate synopsis for inline display (first ~2000 chars)
  const inlineSynopsis = outputs.synopsis.length > 2000
    ? outputs.synopsis.slice(0, 2000) + "\n\n[Full synopsis available via download link below]"
    : outputs.synopsis;

  const htmlBody = buildDeliveryHtml(deal, inlineSynopsis, urls);

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: deal.sender_email,
    subject: `CIMScan — Analysis Complete: ${deal.deal_name}`,
    html: htmlBody,
  });

  if (error) {
    throw new Error(`Failed to send delivery email: ${JSON.stringify(error)}`);
  }

  console.log(`[delivery] Email sent to ${deal.sender_email} for deal ${deal.id}`);
}

function buildDeliveryHtml(
  deal: Deal,
  synopsis: string,
  urls: DownloadUrls
): string {
  // Convert markdown-ish synopsis to simple HTML
  const synopsisHtml = synopsis
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a202c; max-width: 640px; margin: 0 auto; padding: 20px; }
    .header { background: #1e293b; color: white; padding: 24px; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 20px; }
    .header p { margin: 4px 0 0; opacity: 0.8; font-size: 14px; }
    .body { background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; }
    .synopsis { background: white; padding: 20px; border-radius: 6px; border: 1px solid #e2e8f0; margin: 16px 0; font-size: 14px; line-height: 1.6; }
    .downloads { margin: 24px 0; }
    .downloads h3 { margin: 0 0 12px; font-size: 16px; }
    .download-link { display: block; padding: 12px 16px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; margin: 8px 0; text-decoration: none; color: #2563eb; font-weight: 500; }
    .download-link:hover { background: #f1f5f9; }
    .download-link .desc { color: #64748b; font-weight: 400; font-size: 13px; }
    .footer { padding: 16px 24px; font-size: 12px; color: #94a3b8; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Analysis Complete</h1>
    <p>${deal.deal_name} — ${deal.claim_depth} Depth</p>
  </div>
  <div class="body">
    <p>Your CIMScan analysis is ready. Here's the synopsis:</p>

    <div class="synopsis">
      <p>${synopsisHtml}</p>
    </div>

    <div class="downloads">
      <h3>Download Your Deliverables</h3>

      <a class="download-link" href="${urls.datasetDUrl}">
        Dataset D (.xlsx)
        <br><span class="desc">12-sheet analytical workbook — claims, gates, hubs, pillars</span>
      </a>

      <a class="download-link" href="${urls.icInsightsUrl}">
        IC Insights (.docx)
        <br><span class="desc">Structured findings document for IC consumption</span>
      </a>

      <a class="download-link" href="${urls.synopsisUrl}">
        Workstream Synopsis (.md)
        <br><span class="desc">Executive summary — readable in under 10 minutes</span>
      </a>
    </div>

    <p style="font-size: 13px; color: #64748b;">
      Download links expire in 7 days. If you need access after expiration,
      log in to your CIMScan dashboard to regenerate links.
    </p>
  </div>
  <div class="footer">
    CIMScan — True Bearing LLC → IC Sentinel<br>
    This analysis presents structured diligence findings. It does not constitute investment advice.
  </div>
</body>
</html>`;
}
