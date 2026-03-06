/**
 * Email Ingest Route — FROM-Based Routing
 *
 * Implements CIMScan Email Ingestion Routing Spec v1.0.
 *
 * DESIGN PRINCIPLE: The sender's authenticated email address (FROM) is the
 * sole authoritative routing key. The ingest address (TO) is logged but
 * NEVER used for routing, matching, or delivery decisions.
 *
 * Flow:
 *   1. Parse envelope (FROM, TO, Subject, Attachments, Message-ID)
 *   2. Dedup on Message-ID
 *   3. FROM lookup → users table (case-insensitive)
 *   4. Validate user (active, firm active, PDF present, size, rate limit)
 *   5. Upload CIM to Supabase Storage
 *   6. Create deal record (linked to user_id + firm_id)
 *   7. Log to inbound_emails audit table
 *   8. Send config email to FROM address
 *
 * Unknown senders get a rejection email. No auto-creation. No fuzzy matching.
 * Unrecognized attachments are NOT stored.
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import { supabase } from "../lib/supabase.js";
import { sendEmail } from "../lib/mailgun.js";

const upload = multer({ storage: multer.memoryStorage() });

const WEB_URL = process.env.WEB_URL ?? "https://web-production-4a3e0.up.railway.app";

// Validation constants (from routing spec)
const MAX_ATTACHMENT_SIZE_BYTES = 32 * 1024 * 1024; // 32 MB
const MAX_UNPROCESSED_DEALS = 5;                      // rate limit per user

export const ingestRouter = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserLookupResult {
  user_id: string;
  user_email: string;
  user_status: string;
  firm_id: string;
  firm_name: string;
  firm_status: string;
}

interface InboundEmailRecord {
  message_id: string | null;
  from_address: string;
  to_address: string | null;
  subject: string | null;
  attachment_count: number;
  attachment_filenames: string[];
  user_id: string | null;
  firm_id: string | null;
  deal_id: string | null;
  status: string;
  rejection_reason: string | null;
}

// ---------------------------------------------------------------------------
// POST /api/email/ingest — Mailgun inbound webhook
// ---------------------------------------------------------------------------

ingestRouter.post(
  "/",
  upload.any(),
  async (req: Request, res: Response) => {
    console.log("[ingest] Received webhook");

    // ── Step 1: Parse envelope ──────────────────────────────────
    var fromAddress = (
      req.body?.sender?.toLowerCase() ??
      req.body?.from?.toLowerCase() ??
      ""
    ).trim();

    var toAddress = (
      req.body?.recipient?.toLowerCase() ?? ""
    ).trim();

    var subject = req.body?.subject ?? null;
    var messageId = req.body?.["Message-Id"] ?? req.body?.["message-id"] ?? null;

    var files = req.files as Express.Multer.File[] | undefined;
    var allFilenames = (files ?? []).map(function(f) { return f.originalname || "unknown"; });

    console.log(
      "[ingest] FROM: " + fromAddress +
      ", TO: " + toAddress +
      ", Subject: " + (subject || "(none)") +
      ", Message-ID: " + (messageId || "(none)") +
      ", Attachments: " + allFilenames.length
    );

    if (!fromAddress) {
      console.error("[ingest] No sender in payload");
      res.status(400).json({ error: "No sender" });
      return;
    }

    // ── Step 2: Dedup on Message-ID ─────────────────────────────
    if (messageId) {
      var { data: existingEmail } = await supabase
        .from("inbound_emails")
        .select("id")
        .eq("message_id", messageId)
        .maybeSingle();

      if (existingEmail) {
        console.log("[ingest] Duplicate message discarded: " + messageId);
        res.status(200).json({ status: "duplicate", message_id: messageId });
        return;
      }
    }

    // ── Step 3: FROM lookup → users table ───────────────────────
    var userLookup = await lookupUserByEmail(fromAddress);

    if (!userLookup) {
      // Unknown sender path
      console.warn("[ingest] Unknown sender: " + fromAddress);

      await logInboundEmail({
        message_id: messageId,
        from_address: fromAddress,
        to_address: toAddress,
        subject: subject,
        attachment_count: allFilenames.length,
        attachment_filenames: allFilenames,
        user_id: null,
        firm_id: null,
        deal_id: null,
        status: "unknown_sender",
        rejection_reason: "FROM address not registered",
      });

      // Send rejection email (do NOT store the PDF)
      await sendUnknownSenderEmail(fromAddress);

      res.status(200).json({ status: "unknown_sender", from: fromAddress });
      return;
    }

    // ── Step 4: Validate user ───────────────────────────────────

    // 4a: User active?
    if (userLookup.user_status !== "active") {
      await logAndReject(
        messageId, fromAddress, toAddress, subject, allFilenames,
        userLookup.user_id, userLookup.firm_id,
        "inactive_user", "Your CIMScan account is currently inactive."
      );
      res.status(200).json({ status: "rejected", reason: "inactive_user" });
      return;
    }

    // 4b: Firm active?
    if (userLookup.firm_status !== "active") {
      await logAndReject(
        messageId, fromAddress, toAddress, subject, allFilenames,
        userLookup.user_id, userLookup.firm_id,
        "inactive_firm", "Your firm's CIMScan account is currently inactive."
      );
      res.status(200).json({ status: "rejected", reason: "inactive_firm" });
      return;
    }

    // 4c: PDF attachment present?
    var pdfFile = (files ?? []).find(function(f) {
      return (
        f.mimetype === "application/pdf" ||
        (f.originalname ?? "").toLowerCase().endsWith(".pdf")
      );
    });

    if (!pdfFile) {
      await logAndReject(
        messageId, fromAddress, toAddress, subject, allFilenames,
        userLookup.user_id, userLookup.firm_id,
        "validation_failed", "No PDF attachment found. Please resend with a PDF."
      );
      res.status(200).json({ status: "rejected", reason: "no_pdf" });
      return;
    }

    // 4d: File size?
    if (pdfFile.size > MAX_ATTACHMENT_SIZE_BYTES) {
      await logAndReject(
        messageId, fromAddress, toAddress, subject, allFilenames,
        userLookup.user_id, userLookup.firm_id,
        "validation_failed",
        "PDF exceeds the 32 MB limit (" + Math.round(pdfFile.size / 1024 / 1024) + " MB). Please reduce the file size and resend."
      );
      res.status(200).json({ status: "rejected", reason: "file_too_large" });
      return;
    }

    // 4e: Rate limit?
    var { count: queueDepth } = await supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userLookup.user_id)
      .in("status", ["received", "pending_config", "pipeline_queued", "pipeline_running"]);

    if ((queueDepth ?? 0) >= MAX_UNPROCESSED_DEALS) {
      await logAndReject(
        messageId, fromAddress, toAddress, subject, allFilenames,
        userLookup.user_id, userLookup.firm_id,
        "validation_failed",
        "You have " + queueDepth + " unprocessed deals in your queue. Please wait for some to complete before submitting more."
      );
      res.status(200).json({ status: "rejected", reason: "rate_limit" });
      return;
    }

    console.log(
      "[ingest] Sender validated: " + fromAddress +
      " → user " + userLookup.user_id +
      " @ " + userLookup.firm_name
    );

    // ── Step 5: Upload CIM to Supabase Storage ─────────────────
    var timestamp = Date.now();
    var safeFilename =
      pdfFile.originalname?.replace(/[^a-zA-Z0-9._-]/g, "_") ?? "cim.pdf";
    var storagePath = userLookup.firm_id + "/" + timestamp + "_" + safeFilename;

    var { error: uploadError } = await supabase.storage
      .from("cims")
      .upload(storagePath, pdfFile.buffer, {
        contentType: "application/pdf",
      });

    if (uploadError) {
      console.error("[ingest] PDF upload failed:", uploadError);
      res.status(500).json({ error: "Failed to upload PDF" });
      return;
    }

    // ── Step 6: Create deal record ──────────────────────────────
    var dealName = subject ?? pdfFile.originalname ?? "Untitled CIM";

    var { data: deal, error: dealError } = await supabase
      .from("deals")
      .insert({
        firm_id: userLookup.firm_id,
        user_id: userLookup.user_id,
        deal_name: dealName,
        sender_email: fromAddress,
        cim_storage_path: storagePath,
        status: "received",
        source_email_message_id: messageId,
        ingest_address_used: toAddress || null,
      })
      .select("id")
      .single();

    if (dealError || !deal) {
      console.error("[ingest] Failed to create deal:", dealError);
      res.status(500).json({ error: "Failed to create deal" });
      return;
    }

    console.log(
      "[ingest] Deal " + deal.id + " created for " +
      userLookup.firm_name + " from " + fromAddress
    );

    // ── Step 7: Log to inbound_emails ───────────────────────────
    await logInboundEmail({
      message_id: messageId,
      from_address: fromAddress,
      to_address: toAddress,
      subject: subject,
      attachment_count: allFilenames.length,
      attachment_filenames: allFilenames,
      user_id: userLookup.user_id,
      firm_id: userLookup.firm_id,
      deal_id: deal.id,
      status: "processed",
      rejection_reason: null,
    });

    // ── Step 8: Send config email ───────────────────────────────
    var configureUrl = WEB_URL + "/deals/" + deal.id + "/configure";

    var now = new Date();
    var receivedAt =
      now.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }) +
      ", " +
      now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      }) +
      " UTC";

    try {
      await sendEmail({
        to: fromAddress,
        subject: "CIMScan: " + dealName + " — Received",
        html: buildAcknowledgmentEmail({
          dealName: dealName,
          filename: safeFilename,
          firmName: userLookup.firm_name,
          configureUrl: configureUrl,
          receivedAt: receivedAt,
        }),
      });
      console.log("[ingest] Config email sent to " + fromAddress);
    } catch (emailErr) {
      console.error("[ingest] Failed to send config email:", emailErr);
    }

    // ── Return 200 ──────────────────────────────────────────────
    res.status(200).json({
      deal_id: deal.id,
      firm: userLookup.firm_name,
      user_id: userLookup.user_id,
      filename: safeFilename,
      status: "received",
    });
  }
);

// ---------------------------------------------------------------------------
// FROM lookup — case-insensitive, exact email match
// ---------------------------------------------------------------------------

async function lookupUserByEmail(email: string): Promise<UserLookupResult | null> {
  // Supabase doesn't support LOWER() in .eq(), so we use .ilike() for case-insensitive match
  // on email, then filter to exact match (no wildcards)
  var { data, error } = await supabase
    .from("users")
    .select("id, email, firm_id, status, firms!inner(name)")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  var firm = data.firms as unknown as { name: string };

  return {
    user_id: data.id,
    user_email: data.email,
    user_status: data.status,
    firm_id: data.firm_id,
    firm_name: firm.name,
    firm_status: "active",  // firms table has no status column — assume active
  };
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

async function logInboundEmail(record: InboundEmailRecord): Promise<void> {
  var { error } = await supabase
    .from("inbound_emails")
    .insert({
      message_id: record.message_id,
      from_address: record.from_address,
      to_address: record.to_address,
      subject: record.subject,
      attachment_count: record.attachment_count,
      attachment_filenames: record.attachment_filenames,
      user_id: record.user_id,
      firm_id: record.firm_id,
      deal_id: record.deal_id,
      status: record.status,
      rejection_reason: record.rejection_reason,
      processed_at: record.status === "processed" ? new Date().toISOString() : null,
    });

  if (error) {
    console.error("[ingest] Failed to log inbound email:", error);
  }
}

// ---------------------------------------------------------------------------
// Rejection helper — logs + sends rejection email in one call
// ---------------------------------------------------------------------------

async function logAndReject(
  messageId: string | null,
  fromAddress: string,
  toAddress: string | null,
  subject: string | null,
  filenames: string[],
  userId: string,
  firmId: string,
  status: string,
  rejectionMessage: string
): Promise<void> {
  console.warn("[ingest] Rejected " + fromAddress + ": " + status + " — " + rejectionMessage);

  await logInboundEmail({
    message_id: messageId,
    from_address: fromAddress,
    to_address: toAddress,
    subject: subject,
    attachment_count: filenames.length,
    attachment_filenames: filenames,
    user_id: userId,
    firm_id: firmId,
    deal_id: null,
    status: status,
    rejection_reason: rejectionMessage,
  });

  try {
    await sendEmail({
      to: fromAddress,
      subject: "CIMScan — Submission Not Processed",
      html: buildRejectionEmail(rejectionMessage),
    });
  } catch (err) {
    console.error("[ingest] Failed to send rejection email:", err);
  }
}

// ---------------------------------------------------------------------------
// Unknown sender email
// ---------------------------------------------------------------------------

async function sendUnknownSenderEmail(fromAddress: string): Promise<void> {
  try {
    await sendEmail({
      to: fromAddress,
      subject: "CIMScan — Email Not Recognized",
      html: buildRejectionEmail(
        "We received your email but your address is not registered with CIMScan. " +
        "Visit cimscan.ai to create an account, or contact support@cimscan.ai if you believe this is an error."
      ),
    });
  } catch (err) {
    console.error("[ingest] Failed to send unknown sender email:", err);
  }
}

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------

function buildAcknowledgmentEmail(params: {
  dealName: string;
  filename: string;
  firmName: string;
  configureUrl: string;
  receivedAt: string;
}): string {
  var { dealName, filename, firmName, configureUrl, receivedAt } = params;

  return '<!DOCTYPE html>\n' +
    '<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>\n' +
    '<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">\n' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:40px 20px;"><tr><td align="center">\n' +
    '<table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">\n' +
    '<tr><td style="padding:32px 40px 24px 40px;">\n' +
    '<h1 style="margin:0 0 8px 0; font-size:20px; font-weight:600; color:#18181b;">CIM Received</h1>\n' +
    '<p style="margin:0; font-size:14px; color:#71717a;">Your document is ready to configure for analysis.</p>\n' +
    '</td></tr>\n' +
    '<tr><td style="padding:0 40px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafa; border:1px solid #e4e4e7; border-radius:6px;"><tr><td style="padding:20px;">\n' +
    '<table width="100%" cellpadding="0" cellspacing="0">\n' +
    '<tr><td style="padding:4px 0; font-size:13px; color:#71717a; width:100px;">Deal</td><td style="padding:4px 0; font-size:13px; color:#18181b; font-weight:500;">' + dealName + '</td></tr>\n' +
    '<tr><td style="padding:4px 0; font-size:13px; color:#71717a;">File</td><td style="padding:4px 0; font-size:13px; color:#18181b; font-weight:500;">' + filename + '</td></tr>\n' +
    '<tr><td style="padding:4px 0; font-size:13px; color:#71717a;">Firm</td><td style="padding:4px 0; font-size:13px; color:#18181b; font-weight:500;">' + firmName + '</td></tr>\n' +
    '<tr><td style="padding:4px 0; font-size:13px; color:#71717a;">Status</td><td style="padding:4px 0; font-size:13px; color:#18181b; font-weight:500;">Received \u2014 Awaiting Configuration</td></tr>\n' +
    '<tr><td style="padding:4px 0; font-size:13px; color:#71717a;">Received</td><td style="padding:4px 0; font-size:13px; color:#18181b; font-weight:500;">' + receivedAt + '</td></tr>\n' +
    '</table></td></tr></table></td></tr>\n' +
    '<tr><td style="padding:28px 40px;"><table cellpadding="0" cellspacing="0"><tr>\n' +
    '<td style="background-color:#18181b; border-radius:6px;">\n' +
    '<a href="' + configureUrl + '" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none;">Configure Analysis</a>\n' +
    '</td></tr></table></td></tr>\n' +
    '<tr><td style="padding:20px 40px 32px 40px; border-top:1px solid #e4e4e7;">\n' +
    '<p style="margin:0; font-size:12px; color:#a1a1aa;">CIMScan by True Bearing LLC \u00b7 IC Sentinel Product Group</p>\n' +
    '</td></tr></table></td></tr></table></body></html>';
}

function buildRejectionEmail(reason: string): string {
  return '<!DOCTYPE html>\n' +
    '<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>\n' +
    '<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">\n' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:40px 20px;"><tr><td align="center">\n' +
    '<table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">\n' +
    '<tr><td style="padding:32px 40px 24px 40px;">\n' +
    '<h1 style="margin:0 0 8px 0; font-size:20px; font-weight:600; color:#18181b;">Submission Not Processed</h1>\n' +
    '<p style="margin:0; font-size:14px; color:#71717a;">' + reason + '</p>\n' +
    '</td></tr>\n' +
    '<tr><td style="padding:20px 40px 32px 40px; border-top:1px solid #e4e4e7;">\n' +
    '<p style="margin:0; font-size:12px; color:#a1a1aa;">CIMScan by True Bearing LLC \u00b7 IC Sentinel Product Group</p>\n' +
    '</td></tr></table></td></tr></table></body></html>';
}
