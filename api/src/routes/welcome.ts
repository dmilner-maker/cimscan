// api/src/routes/welcome.ts
// Receives Supabase Auth webhook on email verification
// and sends a welcome email via Mailgun.
//
// Setup in Supabase:
//   Dashboard → Database → Webhooks → Create webhook
//   Table: auth.users
//   Events: UPDATE
//   URL: https://api-production-8be1.up.railway.app/api/auth/welcome-webhook
//   HTTP Method: POST
//
// Supabase sends the full user row on update — we check for
// email_confirmed_at transitioning from null to a value.

import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase.js";
import { sendEmail } from "../lib/mailgun.js";

const router = Router();

router.post("/welcome-webhook", async (req: Request, res: Response) => {
  // Always respond 200 immediately so Supabase doesn't retry
  res.json({ ok: true });

  try {
    const { type, record, old_record } = req.body;

    // Only fire on UPDATE where email_confirmed_at just became set
    if (type !== "UPDATE") return;
    if (!record?.email_confirmed_at) return;
    if (old_record?.email_confirmed_at) return; // already confirmed before

    const email = record.email;
    const userId = record.id;

    if (!email) return;

    // Look up user + firm details
    const { data: user } = await supabase
      .from("users")
      .select("display_name, firm_id, firms(name, ingest_address)")
      .eq("id", userId)
      .maybeSingle();

    if (!user) {
      console.log("[welcome] No user row found for auth id " + userId + " — skipping");
      return;
    }

    const displayName = user.display_name || "";
    const firm = (user as any).firms;
    const firmName = firm?.name || "";
    const ingestAddress = firm?.ingest_address || "";

    // Look up promo code if one was issued for this firm
    let promoCode: string | null = null;
    if (user.firm_id) {
      const { data: promo } = await supabase
        .from("promo_codes")
        .select("code")
        .eq("firm_id", user.firm_id)
        .eq("type", "first_run_free")
        .is("redeemed_at", null)
        .maybeSingle();

      if (promo) promoCode = promo.code;
    }

    await sendEmail({
      to: email,
      subject: "Welcome to CIMScan — your ingest address is ready",
      html: buildWelcomeEmail(displayName, firmName, ingestAddress, promoCode),
    });

    console.log("[welcome] Welcome email sent to " + email);

  } catch (err) {
    console.error("[welcome] Error processing webhook:", err);
  }
});

export default router;

// ---------------------------------------------------------------------------
// Welcome email HTML
// ---------------------------------------------------------------------------

function buildWelcomeEmail(
  displayName: string,
  firmName: string,
  ingestAddress: string,
  promoCode: string | null
): string {

  const greeting = displayName ? "Hi " + displayName + "," : "Hi,";
  const firmLine = firmName ? firmName + "'s" : "Your firm's";

  const promoBlock = promoCode
    ? '<tr><td style="padding-bottom:28px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(201,169,110,0.06);border:1px solid rgba(201,169,110,0.2);border-radius:8px;">' +
      '<tr><td style="padding:16px 20px;">' +
      '<p style="font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#c9a96e;margin:0 0 6px;letter-spacing:0.5px;text-transform:uppercase;">First run is on us</p>' +
      '<p style="font-family:Arial,sans-serif;font-size:14px;color:#9a9488;margin:0 0 8px;line-height:1.5;">Use this code when you configure your first scan — it covers CORE or FULL depth.</p>' +
      '<p style="font-family:Courier New,monospace;font-size:18px;font-weight:bold;color:#f0ebe3;margin:0;letter-spacing:2px;">' + promoCode + '</p>' +
      '</td></tr></table>' +
      '</td></tr>'
    : '';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
    '<body style="margin:0;padding:0;background:#0f0e0c;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f0e0c;">' +
    '<tr><td align="center" style="padding:40px 16px;">' +
    '<table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">' +

    // Header
    '<tr><td style="padding-bottom:8px;">' +
    '<p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;color:#c9a96e;letter-spacing:2px;text-transform:uppercase;margin:0;">IC Sentinel &mdash; A True Bearing LLC Product</p>' +
    '</td></tr>' +
    '<tr><td style="padding-bottom:32px;">' +
    '<p style="font-family:Georgia,serif;font-size:28px;font-weight:normal;color:#f0ebe3;margin:0;letter-spacing:-0.5px;">CIMScan</p>' +
    '</td></tr>' +

    // Greeting
    '<tr><td style="padding-bottom:8px;">' +
    '<p style="font-family:Georgia,serif;font-size:22px;font-weight:normal;color:#f0ebe3;margin:0;line-height:1.3;">You\'re verified. Let\'s scan some CIMs.</p>' +
    '</td></tr>' +
    '<tr><td style="padding-bottom:28px;">' +
    '<p style="font-family:Arial,sans-serif;font-size:14px;color:#9a9488;line-height:1.6;margin:0;">' + greeting + ' ' + firmLine + ' CIMScan account is active. Here\'s everything you need to get started.</p>' +
    '</td></tr>' +

    // Ingest address box
    '<tr><td style="padding-bottom:28px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:8px;">' +
    '<tr><td style="padding:16px 20px;">' +
    '<p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;color:#6a6258;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 8px;">Your firm\'s unique ingest address</p>' +
    '<p style="font-family:Courier New,monospace;font-size:15px;color:#c9a96e;margin:0;word-break:break-all;">' + ingestAddress + '</p>' +
    '<p style="font-family:Arial,sans-serif;font-size:12px;color:#6a6258;margin:8px 0 0;line-height:1.5;">Email your CIM PDFs to this address to begin a scan. Only registered users from your firm can submit.</p>' +
    '</td></tr></table>' +
    '</td></tr>' +

    // Promo code block (if applicable)
    promoBlock +

    // Divider
    '<tr><td style="padding-bottom:24px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid rgba(255,255,255,0.06);font-size:0;">&nbsp;</td></tr></table></td></tr>' +

    // How it works
    '<tr><td style="padding-bottom:20px;">' +
    '<p style="font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#f0ebe3;letter-spacing:0.5px;margin:0 0 16px;text-transform:uppercase;">How it works</p>' +
    '</td></tr>' +

    // Step 1
    '<tr><td style="padding-bottom:16px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="32" valign="top" style="padding-top:2px;"><div style="width:24px;height:24px;border-radius:50%;background:rgba(201,169,110,0.1);border:1px solid rgba(201,169,110,0.3);text-align:center;line-height:22px;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:#c9a96e;">1</div></td>' +
    '<td style="padding-left:12px;"><p style="font-family:Arial,sans-serif;font-size:14px;color:#f0ebe3;font-weight:bold;margin:0 0 4px;">Email a CIM</p><p style="font-family:Arial,sans-serif;font-size:13px;color:#9a9488;margin:0;line-height:1.5;">Attach the CIM PDF and send it to your firm\'s ingest address above. CIMScan will validate the file and create a deal.</p></td>' +
    '</tr></table>' +
    '</td></tr>' +

    // Step 2
    '<tr><td style="padding-bottom:16px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="32" valign="top" style="padding-top:2px;"><div style="width:24px;height:24px;border-radius:50%;background:rgba(201,169,110,0.1);border:1px solid rgba(201,169,110,0.3);text-align:center;line-height:22px;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:#c9a96e;">2</div></td>' +
    '<td style="padding-left:12px;"><p style="font-family:Arial,sans-serif;font-size:14px;color:#f0ebe3;font-weight:bold;margin:0 0 4px;">Configure your scan</p><p style="font-family:Arial,sans-serif;font-size:13px;color:#9a9488;margin:0;line-height:1.5;">Open the confirmation email, choose CORE or FULL depth, accept the CIMScan Terms of Service, and confirm payment. Your first scan is free.</p></td>' +
    '</tr></table>' +
    '</td></tr>' +

    // Step 3
    '<tr><td style="padding-bottom:32px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="32" valign="top" style="padding-top:2px;"><div style="width:24px;height:24px;border-radius:50%;background:rgba(201,169,110,0.1);border:1px solid rgba(201,169,110,0.3);text-align:center;line-height:22px;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:#c9a96e;">3</div></td>' +
    '<td style="padding-left:12px;"><p style="font-family:Arial,sans-serif;font-size:14px;color:#f0ebe3;font-weight:bold;margin:0 0 4px;">Receive your deliverables</p><p style="font-family:Arial,sans-serif;font-size:13px;color:#9a9488;margin:0;line-height:1.5;">When the pipeline completes, you\'ll receive an email with your Dataset D workbook and IC Insights narrative — ready for your diligence process.</p></td>' +
    '</tr></table>' +
    '</td></tr>' +

    // Footer
    '<tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid rgba(255,255,255,0.06);font-size:0;">&nbsp;</td></tr></table></td></tr>' +
    '<tr><td style="padding-top:20px;"><p style="font-family:Arial,sans-serif;font-size:12px;color:#6a6258;margin:0;line-height:1.5;">CIMScan &mdash; IC Sentinel &mdash; True Bearing LLC<br>Questions? Reply to this email.</p></td></tr>' +

    '</table></td></tr></table></body></html>';
}
