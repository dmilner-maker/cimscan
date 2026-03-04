import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase.js";
import { createPromoCode } from "../services/promo.js";

export const adminRouter = Router();

/**
 * POST /api/admin/promo-codes
 *
 * Generate a promo code for a specific firm.
 * Body: { firm_id, tier?, expires_in_hours?, created_by? }
 *
 * TODO: Add admin auth middleware before going to production.
 */
adminRouter.post("/promo-codes", async (req: Request, res: Response) => {
  const { firm_id, tier, expires_in_hours, created_by } = req.body;

  if (!firm_id) {
    res.status(400).json({ error: "firm_id is required" });
    return;
  }

  // Verify firm exists
  const { data: firm, error: firmError } = await supabase
    .from("firms")
    .select("id, name")
    .eq("id", firm_id)
    .single();

  if (firmError || !firm) {
    res.status(404).json({ error: "Firm not found" });
    return;
  }

  try {
    const promo = await createPromoCode({
      firmId: firm_id,
      type: "admin",
      tier: tier || "ANY",
      createdBy: created_by,
      expiresInHours: expires_in_hours || 72,
    });

    console.log(`[admin] Generated promo code ${promo.code} for firm "${firm.name}" (${firm_id})`);

    res.json({
      code: promo.code,
      firm_name: firm.name,
      tier: promo.tier,
      expires_at: promo.expires_at,
    });
  } catch (err) {
    console.error("[admin] Failed to generate promo code:", err);
    res.status(500).json({ error: "Failed to generate promo code" });
  }
});

/**
 * GET /api/admin/promo-codes/:firm_id
 *
 * List all promo codes for a firm.
 */
adminRouter.get("/promo-codes/:firm_id", async (req: Request, res: Response) => {
  const { firm_id } = req.params;

  const { data: codes, error } = await supabase
    .from("promo_codes")
    .select("id, code, type, tier, created_by, created_at, expires_at, redeemed_at, redeemed_deal_id")
    .eq("firm_id", firm_id)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "Failed to fetch promo codes" });
    return;
  }

  res.json(codes);
});