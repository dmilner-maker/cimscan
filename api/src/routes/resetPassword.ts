// api/src/routes/resetPassword.ts
// Generates a Supabase password reset link and sends it via Mailgun.
// Mount in index.ts: app.use('/api/auth', resetPasswordRouter)

import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { sendEmail } from '../lib/mailgun.js'

const router = Router()

router.post('/reset-password', async (req: Request, res: Response) => {
  const { email } = req.body

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required.' })
  }

  try {
    // Generate a password reset link via Supabase Admin API
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: email.toLowerCase().trim(),
      options: {
        redirectTo: `${process.env.WEB_URL}/reset-password`,
      },
    })

    if (error) {
      console.error('[reset-password] generateLink error:', error.message)
      // Always return success to prevent email enumeration
      return res.json({ ok: true })
    }

    const resetLink = data?.properties?.action_link
    if (!resetLink) {
      console.error('[reset-password] No action_link returned')
      return res.json({ ok: true })
    }

    // Send via Mailgun
    await sendEmail({
      to: email,
      subject: 'Reset your CIMScan password',
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
        <body style="margin:0;padding:0;background:#0f0e0c;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f0e0c;">
            <tr>
              <td align="center" style="padding:40px 16px;">
                <table width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;">

                  <!-- Wordmark -->
                  <tr>
                    <td style="padding-bottom:32px;">
                      <span style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#c9a96e;letter-spacing:1px;">CIMScan</span>
                    </td>
                  </tr>

                  <!-- Heading -->
                  <tr>
                    <td style="padding-bottom:12px;">
                      <p style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:normal;color:#f0ebe3;margin:0;line-height:1.3;">Reset your password</p>
                    </td>
                  </tr>

                  <!-- Body text -->
                  <tr>
                    <td style="padding-bottom:32px;">
                      <p style="font-family:Arial,sans-serif;font-size:14px;color:#9a9488;line-height:1.6;margin:0;">
                        Click the button below to set a new password. This link expires in 1 hour.
                        If you didn't request a reset, you can safely ignore this email.
                      </p>
                    </td>
                  </tr>

                  <!-- CTA Button -->
                  <tr>
                    <td style="padding-bottom:32px;">
                      <table cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td align="center" bgcolor="#c9a96e" style="border-radius:8px;">
                            <a href="\${resetLink}"
                               target="_blank"
                               style="display:inline-block;padding:14px 32px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:#0f0e0c;text-decoration:none;border-radius:8px;letter-spacing:0.5px;">
                              Reset password
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Fallback link -->
                  <tr>
                    <td>
                      <p style="font-family:Arial,sans-serif;font-size:12px;color:#6a6258;margin:0;line-height:1.5;">
                        If the button above doesn't work, copy this link into your browser:<br>
                        <span style="color:#9a9488;word-break:break-all;">\${resetLink}</span>
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    })

    console.log(`[reset-password] Reset email sent to ${email}`)
    return res.json({ ok: true })

  } catch (err) {
    console.error('[reset-password] Unexpected error:', err)
    // Always return success to prevent email enumeration
    return res.json({ ok: true })
  }
})

export default router
