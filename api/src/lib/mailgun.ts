// api/src/lib/mailgun.ts

import fetch from "node-fetch";

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY!;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN!; // ingest.cimscan.ai
const FROM_ADDRESS = `CIMScan <noreply@${MAILGUN_DOMAIN}>`;

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  const url = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;

  const form = new URLSearchParams();
  form.append("from", FROM_ADDRESS);
  form.append("to", to);
  form.append("subject", subject);
  form.append("html", html);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64")}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mailgun send failed (${response.status}): ${body}`);
  }
}