import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase.js";
import { createPaymentAuth } from "../services/payment.js";
import { validatePromoCode, redeemPromoCode } from "../services/promo.js";
import { PRICING, ClaimDepth } from "../lib/stripe.js";

export const dealsRouter = Router();

/**
 * GET /api/deals/:id
 */
dealsRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  const { data: deal, error } = await supabase
    .from("deals")
    .select("id, deal_name, sender_email, cim_storage_path, status, claim_depth, terms_accepted_at, created_at, firm_id")
    .eq("id", id)
    .single();

  if (error || !deal) {
    console.error("[deals] Deal not found:", id, error);
    res.status(404).json({ error: "Deal not found" });
    return;
  }

  const { data: firm } = await supabase
    .from("firms")
    .select("name")
    .eq("id", deal.firm_id)
    .single();

  res.json({
    id: deal.id,
    deal_name: deal.deal_name,
    sender_email: deal.sender_email,
    filename: (deal.cim_storage_path?.split("/").pop() ?? "Unknown").replace(/^\d+_/, ""),
    claim_depth: deal.claim_depth,
    terms_accepted_at: deal.terms_accepted_at,
    firm_name: firm?.name ?? "Unknown",
    created_at: deal.created_at,
    pricing: {
      CORE: PRICING.CORE.amount,
      FULL: PRICING.FULL.amount,
    },
  });
});

/**
 * POST /api/deals/:id/configure
 *
 * Accepts terms, sets claim depth, then either:
 *   A) Authorizes payment via Stripe (payment_method_id provided)
 *   B) Redeems a promo code (promo_code provided, no payment)
 *
 * Body: { claim_depth, terms_accepted, payment_method_id?, promo_code? }
 */
dealsRouter.post("/:id/configure", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { claim_depth, terms_accepted, payment_method_id, promo_code } = req.body;

  // --- Validate inputs ---
  if (!terms_accepted) {
    res.status(400).json({ error: "Terms must be accepted" });
    return;
  }

  if (claim_depth !== "CORE" && claim_depth !== "FULL") {
    res.status(400).json({ error: "claim_depth must be CORE or FULL" });
    return;
  }

  // Must provide either payment method or promo code
  if (!payment_method_id && !promo_code) {
    res.status(400).json({ error: "payment_method_id or promo_code is required" });
    return;
  }

  // --- Verify deal exists and hasn't already been configured ---
  const { data: deal, error: fetchError } = await supabase
    .from("deals")
    .select("id, status, terms_accepted_at, sender_email, firm_id")
    .eq("id", id)
    .single();

  if (fetchError || !deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }

  if (deal.terms_accepted_at) {
    res.status(409).json({ error: "Deal has already been configured" });
    return;
  }

  if (deal.status !== "received") {
    res.status(409).json({ error: `Deal status is '${deal.status}', expected 'received'` });
    return;
  }

  // --- PROMO CODE PATH ---
  if (promo_code) {
    const validation = await validatePromoCode(promo_code, deal.firm_id, claim_depth as "CORE" | "FULL");

    if (!validation.valid) {
      res.status(400).json({ error: validation.reason });
      return;
    }

    try {
      // Accept terms + configure deal with $0
      await supabase
        .from("deals")
        .update({
          terms_accepted_at: new Date().toISOString(),
          claim_depth,
          status: "pipeline_queued",
          payment_amount_cents: 0,
        })
        .eq("id", id);

      // Redeem the code
      await redeemPromoCode(validation.promoCode.id, id);

      console.log(`[deals] Deal ${id} configured via promo code ${promo_code}: ${claim_depth}, $0`);

      res.json({
        deal_id: id,
        claim_depth,
        status: "pipeline_queued",
        amount: 0,
        promo_applied: true,
      });
    } catch (err) {
      console.error("[deals] Promo redemption error:", err);
      res.status(500).json({ error: "Failed to apply promo code" });
    }
    return;
  }

  // --- STRIPE PAYMENT PATH ---
  // Accept terms first
  const { error: termsError } = await supabase
    .from("deals")
    .update({
      terms_accepted_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (termsError) {
    console.error("[deals] Failed to accept terms:", termsError);
    res.status(500).json({ error: "Failed to configure deal" });
    return;
  }

  // Look up firm for Stripe customer ID
  const { data: firm } = await supabase
    .from("firms")
    .select("stripe_customer_id")
    .eq("id", deal.firm_id)
    .single();

  try {
    const { paymentIntent, clientSecret } = await createPaymentAuth(
      id,
      claim_depth as ClaimDepth,
      deal.sender_email,
      deal.firm_id,
      firm?.stripe_customer_id ?? null,
      payment_method_id
    );

    console.log(`[deals] Deal ${id} configured: ${claim_depth}, payment authorized (${paymentIntent.id})`);

    res.json({
      deal_id: id,
      claim_depth,
      status: "payment_authorized",
      amount: PRICING[claim_depth as ClaimDepth].amount,
      stripe_client_secret: clientSecret,
    });
  } catch (err: any) {
    console.error("[deals] Stripe error:", err);

    // Roll back terms acceptance on payment failure
    await supabase
      .from("deals")
      .update({ terms_accepted_at: null })
      .eq("id", id);

    if (err.type === "StripeCardError") {
      res.status(402).json({
        error: "Card declined",
        decline_code: err.decline_code,
        message: err.message,
      });
      return;
    }

    res.status(500).json({ error: "Payment processing failed" });
  }
});