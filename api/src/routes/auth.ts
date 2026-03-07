/**
 * Auth Routes — User Signup + Firm Registration
 *
 * POST /api/auth/signup
 *   - Existing firm: pick from dropdown, create user, verify email
 *   - New firm: validate website, create firm + user, verify email
 *   - Issues a first-run-free promo code (one per firm, CORE or FULL)
 *
 * POST /api/auth/verify-email
 *   - Confirm email verification token (Supabase Auth handles this,
 *     but we expose an endpoint for the frontend to check status)
 *
 * GET /api/firms
 *   - Searchable firm list for the signup dropdown
 *
 * GET /api/firms/:id
 *   - Single firm details
 */

import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase.js";
import { sendEmail } from "../lib/mailgun.js";
import { issueFirstRunFreeCode } from "../services/promo.js";

export const authRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/firms — Searchable firm list for dropdown
// ---------------------------------------------------------------------------

authRouter.get("/firms", async (req: Request, res: Response) => {
  var search = String(req.query.search || "").trim();
  var limit = Math.min(Number(req.query.limit) || 50, 200);

  var query = supabase
    .from("firms")
    .select("id, name, website, ingest_address")
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(limit);

  if (search.length >= 2) {
    query = query.ilike("name", "%" + search + "%");
  }

  var { data: firms, error } = await query;

  if (error) {
    console.error("[auth] Firm search error:", error);
    res.status(500).json({ error: "Failed to search firms" });
    return;
  }

  res.json({
    firms: (firms || []).map(function(f: any) {
      return {
        id: f.id,
        name: f.name,
        website: f.website,
        ingest_address: f.ingest_address,
      };
    }),
    count: (firms || []).length,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/signup — Register new user
// ---------------------------------------------------------------------------

interface SignupBody {
  email: string;
  password: string;
  display_name: string;
  // Existing firm
  firm_id?: string;
  // New firm
  new_firm_name?: string;
  new_firm_website?: string;
  new_firm_address?: string;
  new_firm_phone?: string;
}

authRouter.post("/auth/signup", async (req: Request, res: Response) => {
  var body = req.body as SignupBody;

  // ── Validate required fields ──────────────────────────────────
  if (!body.email || !body.password || !body.display_name) {
    res.status(400).json({ error: "email, password, and display_name are required" });
    return;
  }

  var email = body.email.trim().toLowerCase();
  var password = body.password;
  var displayName = body.display_name.trim();

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  // ── Check email not already registered ────────────────────────
  var { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existingUser) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  // ── Resolve firm (existing or new) ────────────────────────────
  var firmId: string;
  var firmName: string;
  var ingestAddress: string;

  if (body.firm_id) {
    // Existing firm path
    var { data: firm, error: firmError } = await supabase
      .from("firms")
      .select("id, name, ingest_address, status")
      .eq("id", body.firm_id)
      .single();

    if (firmError || !firm) {
      res.status(404).json({ error: "Firm not found" });
      return;
    }

    if (firm.status !== "active") {
      res.status(400).json({ error: "This firm is not currently active" });
      return;
    }

    firmId = firm.id;
    firmName = firm.name;
    ingestAddress = firm.ingest_address;
  } else if (body.new_firm_name && body.new_firm_website) {
    // New firm registration path
    var newFirmResult = await createNewFirm(
      body.new_firm_name.trim(),
      body.new_firm_website.trim().toLowerCase(),
      body.new_firm_address?.trim() || null,
      body.new_firm_phone?.trim() || null
    );

    if (!newFirmResult.success) {
      res.status(400).json({ error: newFirmResult.error });
      return;
    }

    firmId = newFirmResult.firmId!;
    firmName = newFirmResult.firmName!;
    ingestAddress = newFirmResult.ingestAddress!;
  } else {
    res.status(400).json({
      error: "Provide either firm_id (existing firm) or new_firm_name + new_firm_website (new firm)",
    });
    return;
  }

  // ── Create Supabase Auth user ──────────────────────────────────
  var { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: email,
    password: password,
    email_confirm: false,  // user must verify via email
    user_metadata: {
      display_name: displayName,
      firm_id: firmId,
      firm_name: firmName,
    },
  });

  if (authError) {
    console.error("[auth] Supabase Auth createUser error:", authError);

    if (authError.message?.includes("already been registered")) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    res.status(500).json({ error: "Failed to create account: " + authError.message });
    return;
  }

  if (!authData.user) {
    res.status(500).json({ error: "Failed to create account — no user returned" });
    return;
  }

  var authUserId = authData.user.id;

  // ── Create user row in users table ────────────────────────────
  var { error: userError } = await supabase
    .from("users")
    .insert({
      id: authUserId,
      email: email,
      firm_id: firmId,
      role: "analyst",
      status: "active",
      display_name: displayName,
    });

  if (userError) {
    console.error("[auth] Failed to create user row:", userError);
    await supabase.auth.admin.deleteUser(authUserId);
    res.status(500).json({ error: "Failed to create user record" });
    return;
  }

  // ── Issue first-run-free promo code (one per firm) ────────────
  var promoCode: string | null = null;
  try {
    var promo = await issueFirstRunFreeCode(firmId, email);
    if (promo) {
      promoCode = promo.code;
    }
  } catch (err) {
    console.error("[auth] Failed to issue first-run-free code:", err);
  }

  // ── Send verification email via Mailgun ───────────────────────
  try {
    var { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "signup",
      email: email,
      password: password,
      options: {
        redirectTo: `${process.env.WEB_URL}/login`,
      },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error("[auth] Failed to generate verification link:", linkError);
    } else {
      var verifyLink = linkData.properties.action_link;

      await sendEmail({
        to: email,
        subject: "Verify your CIMScan account",
        html: `
          <div style="font-family: 'IBM Plex Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #0f0e0c; color: #f0ebe3; padding: 40px 32px; border-radius: 8px;">
            <div style="margin-bottom: 32px;">
              <span style="font-size: 18px; font-weight: 600; color: #c9a96e; letter-spacing: 0.02em;">CIMScan</span>
            </div>
            <h1 style="font-size: 22px; font-weight: 400; color: #f0ebe3; margin: 0 0 12px;">Verify your email address</h1>
            <p style="font-size: 14px; color: #9a9488; line-height: 1.6; margin: 0 0 8px;">
              Welcome to CIMScan${firmName ? ", " + firmName : ""}. Click below to verify your email and activate your account.
            </p>
            ${promoCode ? `
            <p style="font-size: 14px; color: #9a9488; line-height: 1.6; margin: 0 0 24px;">
              Your first analysis is on us — use code <strong style="color: #c9a96e;">${promoCode}</strong> when you configure your first run.
            </p>
            ` : '<div style="margin-bottom: 24px;"></div>'}
            <a href="${verifyLink}"
               style="display: inline-block; background: linear-gradient(135deg, #c9a96e 0%, #8a7448 100%);
                      color: #0f0e0c; font-size: 14px; font-weight: 600; text-decoration: none;
                      padding: 13px 28px; border-radius: 8px; letter-spacing: 0.02em;">
              Verify email
            </a>
            <p style="font-size: 13px; color: #6a6258; margin: 28px 0 8px;">
              Once verified, submit CIMs to:
            </p>
            <p style="font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: #9a9488; margin: 0 0 28px;">
              ${ingestAddress}
            </p>
            <p style="font-size: 12px; color: #6a6258; margin: 0; line-height: 1.5;">
              If the button doesn't work, copy this link into your browser:<br/>
              <span style="color: #9a9488; word-break: break-all;">${verifyLink}</span>
            </p>
          </div>
        `,
      });

      console.log("[auth] Verification email sent to " + email);
    }
  } catch (err) {
    // Non-fatal — user is created, email is a bonus
    console.error("[auth] Failed to send verification email:", err);
  }

  console.log(
    "[auth] User " + authUserId + " created: " + email +
    " → firm " + firmName + " (" + firmId + ")" +
    (promoCode ? " — first-run-free code: " + promoCode : "")
  );

  res.status(201).json({
    user_id: authUserId,
    email: email,
    firm_id: firmId,
    firm_name: firmName,
    ingest_address: ingestAddress,
    promo_code: promoCode,
    status: "verification_email_sent",
    message: promoCode
      ? "Check your email to verify your account. Your first analysis is free — use code " + promoCode + " when you configure your first run. Submit CIMs to " + ingestAddress
      : "Check your email to verify your account. Once verified, you can submit CIMs to " + ingestAddress,
  });
});

// ---------------------------------------------------------------------------
// New firm creation with website validation
// ---------------------------------------------------------------------------

interface NewFirmResult {
  success: boolean;
  error?: string;
  firmId?: string;
  firmName?: string;
  ingestAddress?: string;
}

async function createNewFirm(
  name: string,
  website: string,
  address: string | null,
  phone: string | null
): Promise<NewFirmResult> {

  // ── Normalize website ─────────────────────────────────────────
  var cleanWebsite = website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();

  if (!cleanWebsite.includes(".")) {
    return { success: false, error: "Invalid website URL" };
  }

  // ── Check website not already registered ──────────────────────
  var { data: existingFirm } = await supabase
    .from("firms")
    .select("id, name")
    .ilike("website", cleanWebsite)
    .maybeSingle();

  if (existingFirm) {
    return {
      success: false,
      error: "A firm with website '" + cleanWebsite + "' is already registered (" + existingFirm.name + "). Select it from the dropdown instead.",
    };
  }

  // ── Validate website is reachable ─────────────────────────────
  var isReachable = await validateWebsite(cleanWebsite);
  if (!isReachable) {
    return {
      success: false,
      error: "Could not reach '" + cleanWebsite + "'. Please check the URL and try again.",
    };
  }

  // ── Derive ingest address ─────────────────────────────────────
  var prefix = cleanWebsite.split(".")[0];
  var ingestAddress = prefix + "@ingest.cimscan.ai";

  // Check for ingest address collision
  var { data: collision } = await supabase
    .from("firms")
    .select("id")
    .ilike("ingest_address", ingestAddress)
    .maybeSingle();

  if (collision) {
    var suffix = Math.random().toString(36).substring(2, 6);
    ingestAddress = prefix + "-" + suffix + "@ingest.cimscan.ai";
  }

  // ── Create firm ───────────────────────────────────────────────
  var { data: firm, error: firmError } = await supabase
    .from("firms")
    .insert({
      name: name,
      website: cleanWebsite,
      phone: phone,
      address: address,
      ingest_address: ingestAddress,
      status: "active",
    })
    .select("id, name, ingest_address")
    .single();

  if (firmError || !firm) {
    console.error("[auth] Failed to create firm:", firmError);
    return { success: false, error: "Failed to register firm" };
  }

  console.log("[auth] New firm created: " + firm.name + " (" + firm.id + ") → " + firm.ingest_address);

  return {
    success: true,
    firmId: firm.id,
    firmName: firm.name,
    ingestAddress: firm.ingest_address,
  };
}

// ---------------------------------------------------------------------------
// Website validation — check the URL resolves
// ---------------------------------------------------------------------------

async function validateWebsite(domain: string): Promise<boolean> {
  var urls = [
    "https://" + domain,
    "http://" + domain,
    "https://www." + domain,
    "http://www." + domain,
  ];

  for (var i = 0; i < urls.length; i++) {
    try {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 8000);

      var response = await fetch(urls[i], {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "CIMScan-FirmVerification/1.0",
        },
      });

      clearTimeout(timeout);

      if (response.status < 600) {
        return true;
      }
    } catch (err) {
      continue;
    }
  }

  return false;
}
