import { supabase } from "../lib/supabase.js";
import crypto from "crypto";

/**
 * Generate a short, readable promo code.
 * Format: CIMS-XXXX-XXXX (uppercase alphanumeric, no ambiguous chars)
 */
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const segment = () =>
    Array.from(crypto.randomBytes(4))
      .map((b) => chars[b % chars.length])
      .join("");
  return `CIMS-${segment()}-${segment()}`;
}

export interface CreatePromoCodeOpts {
  firmId: string;
  type?: "admin" | "first_run_free";
  tier?: "CORE" | "FULL" | "ANY";
  createdBy?: string;
  expiresInHours?: number;
}

/**
 * Create a promo code for a specific firm.
 */
export async function createPromoCode(opts: CreatePromoCodeOpts) {
  const {
    firmId,
    type = "admin",
    tier = "CORE",
    createdBy,
    expiresInHours = 72,
  } = opts;

  const code = generateCode();
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("promo_codes")
    .insert({
      code,
      firm_id: firmId,
      type,
      tier,
      created_by: createdBy ?? null,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    console.error("[promo] Failed to create code:", error);
    throw new Error("Failed to create promo code");
  }

  console.log(`[promo] Created ${type} code ${code} for firm ${firmId}, expires ${expiresAt}`);
  return data;
}

export interface ValidateResult {
  valid: true;
  promoCode: {
    id: string;
    code: string;
    firm_id: string;
    type: string;
    tier: string;
  };
}

export interface ValidateError {
  valid: false;
  reason: string;
}

/**
 * Validate a promo code for a specific deal.
 * Checks: exists, matches firm, not expired, not already used, tier compatibility.
 */
export async function validatePromoCode(
  code: string,
  dealFirmId: string,
  claimDepth: "CORE" | "FULL"
): Promise<ValidateResult | ValidateError> {
  const { data: promo, error } = await supabase
    .from("promo_codes")
    .select("id, code, firm_id, type, tier, expires_at, redeemed_at")
    .eq("code", code.toUpperCase().trim())
    .single();

  if (error || !promo) {
    return { valid: false, reason: "Invalid promo code" };
  }

  if (promo.redeemed_at) {
    return { valid: false, reason: "This promo code has already been used" };
  }

  if (new Date(promo.expires_at) < new Date()) {
    return { valid: false, reason: "This promo code has expired" };
  }

  if (promo.firm_id !== dealFirmId) {
    return { valid: false, reason: "This promo code is not valid for your firm" };
  }

  // Tier check: 'ANY' allows both, otherwise must match
  if (promo.tier !== "ANY" && promo.tier !== claimDepth) {
    return {
      valid: false,
      reason: `This promo code is only valid for ${promo.tier} analysis`,
    };
  }

  return { valid: true, promoCode: promo };
}

/**
 * Redeem a promo code — mark it as used and link to the deal.
 */
export async function redeemPromoCode(promoCodeId: string, dealId: string) {
  const { error } = await supabase
    .from("promo_codes")
    .update({
      redeemed_at: new Date().toISOString(),
      redeemed_deal_id: dealId,
    })
    .eq("id", promoCodeId);

  if (error) {
    console.error("[promo] Failed to redeem code:", error);
    throw new Error("Failed to redeem promo code");
  }

  console.log(`[promo] Redeemed code ${promoCodeId} for deal ${dealId}`);
}

/**
 * Issue a first-run-free code for a firm (if not already issued).
 * Call this from your registration flow when a new firm is created.
 */
export async function issueFirstRunFreeCode(firmId: string, firmEmail: string) {
  // Check if already issued
  const { data: firm } = await supabase
    .from("firms")
    .select("first_run_code_issued_at")
    .eq("id", firmId)
    .single();

  if (firm?.first_run_code_issued_at) {
    console.log(`[promo] First-run code already issued for firm ${firmId}`);
    return null;
  }

  const promo = await createPromoCode({
    firmId,
    type: "first_run_free",
    tier: "ANY",
    createdBy: "system",
    expiresInHours: 72,
  });

  await supabase
    .from("firms")
    .update({ first_run_code_issued_at: new Date().toISOString() })
    .eq("id", firmId);

  console.log(`[promo] Issued first-run-free code ${promo.code} for firm ${firmId}`);
  return promo;
}