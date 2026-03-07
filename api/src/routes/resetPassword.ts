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
        <div style="font-family: 'IBM Plex Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #0f0e0c; color: #f0ebe3; padding: 40px 32px; border-radius: 8px;">
          <div style="margin-bottom: 32px;">
            <span style="font-size: 18px; font-weight: 600; color: #c9a96e; letter-spacing: 0.02em;">CIMScan</span>
          </div>
          <h1 style="font-size: 22px; font-weight: 400; color: #f0ebe3; margin: 0 0 12px;">Reset your password</h1>
          <p style="font-size: 14px; color: #9a9488; line-height: 1.6; margin: 0 0 32px;">
            Click the button below to set a new password. This link expires in 1 hour.
            If you didn't request a reset, you can safely ignore this email.
          </p>
          <a href="${resetLink}"
             style="display: inline-block; background: linear-gradient(135deg, #c9a96e 0%, #8a7448 100%);
                    color: #0f0e0c; font-size: 14px; font-weight: 600; text-decoration: none;
                    padding: 13px 28px; border-radius: 8px; letter-spacing: 0.02em;">
            Reset password
          </a>
          <p style="font-size: 12px; color: #6a6258; margin: 32px 0 0; line-height: 1.5;">
            If the button doesn't work, copy this link into your browser:<br/>
            <span style="color: #9a9488; word-break: break-all;">${resetLink}</span>
          </p>
        </div>
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
