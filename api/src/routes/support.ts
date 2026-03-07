// api/src/routes/support.ts
// POST /api/support — submits a help request to help@truebearingllc.com
// Reply-to is set to the submitter's email so responses go directly to them.

import { Router, Request, Response } from "express";
import { sendEmail } from "../lib/mailgun.js";

const router = Router();

interface SupportBody {
  name: string;
  email: string;
  message: string;
}

router.post("/support", async (req: Request, res: Response) => {
  const { name, email, message } = req.body as SupportBody;

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    res.status(400).json({ error: "name, email, and message are required" });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  try {
    await sendEmail({
      to: "help@truebearingllc.com",
      replyTo: email.trim(),
      subject: "CIMScan Support Request — " + name.trim(),
      html: buildSupportEmail(name.trim(), email.trim(), message.trim()),
    });

    console.log("[support] Help request from " + email.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error("[support] Failed to send support email:", err);
    res.status(500).json({ error: "Failed to send message. Please try again." });
  }
});

export default router;

function buildSupportEmail(name: string, email: string, message: string): string {
  const ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });

  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background:#0f0e0c;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f0e0c;">' +
    '<tr><td align="center" style="padding:40px 16px;">' +
    '<table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">' +

    '<tr><td style="padding-bottom:8px;"><p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;color:#c9a96e;letter-spacing:2px;text-transform:uppercase;margin:0;">CIMScan Support</p></td></tr>' +
    '<tr><td style="padding-bottom:28px;"><p style="font-family:Georgia,serif;font-size:22px;color:#f0ebe3;margin:0;">New support request</p></td></tr>' +

    '<tr><td style="padding-bottom:20px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:8px;">' +
    '<tr><td style="padding:16px 20px;">' +
    '<p style="font-family:Arial,sans-serif;font-size:11px;color:#6a6258;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">From</p>' +
    '<p style="font-family:Arial,sans-serif;font-size:14px;color:#f0ebe3;margin:0 0 16px;">' + name + ' &lt;' + email + '&gt;</p>' +
    '<p style="font-family:Arial,sans-serif;font-size:11px;color:#6a6258;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Received</p>' +
    '<p style="font-family:Arial,sans-serif;font-size:14px;color:#9a9488;margin:0;">' + ts + '</p>' +
    '</td></tr></table>' +
    '</td></tr>' +

    '<tr><td style="padding-bottom:28px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:8px;">' +
    '<tr><td style="padding:16px 20px;">' +
    '<p style="font-family:Arial,sans-serif;font-size:11px;color:#6a6258;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Message</p>' +
    '<p style="font-family:Arial,sans-serif;font-size:14px;color:#f0ebe3;line-height:1.7;margin:0;white-space:pre-wrap;">' + message.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</p>' +
    '</td></tr></table>' +
    '</td></tr>' +

    '<tr><td><p style="font-family:Arial,sans-serif;font-size:12px;color:#6a6258;margin:0;">Reply directly to this email to respond to ' + name + '.</p></td></tr>' +

    '</table></td></tr></table></body></html>';
}
