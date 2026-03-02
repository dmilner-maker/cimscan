import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase.js";

export const dealsRouter = Router();

/**
 * GET /api/deals/:id
 *
 * Returns deal info for the configuration page.
 * No auth required — the deal ID is a UUID that acts as a capability URL.
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

  // Get firm name
  const { data: firm } = await supabase
    .from("firms")
    .select("name")
    .eq("id", deal.firm_id)
    .single();

  res.json({
    id: deal.id,
    deal_name: deal.deal_name,
    sender_email: deal.sender_email,
    filename: deal.cim_storage_path?.split("/").pop() ?? "Unknown",
    status: deal.status,
    claim_depth: deal.claim_depth,
    terms_accepted_at: deal.terms_accepted_at,
    firm_name: firm?.name ?? "Unknown",
    created_at: deal.created_at,
  });
});

/**
 * POST /api/deals/:id/configure
 *
 * Accepts terms, sets claim depth.
 * Next step (not yet built): create Stripe PaymentIntent with capture_method: manual.
 *
 * Body: { claim_depth: "CORE" | "FULL", terms_accepted: true }
 */
dealsRouter.post("/:id/configure", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { claim_depth, terms_accepted } = req.body;

  // --- Validate inputs ---
  if (!terms_accepted) {
    res.status(400).json({ error: "Terms must be accepted" });
    return;
  }

  if (claim_depth !== "CORE" && claim_depth !== "FULL") {
    res.status(400).json({ error: "claim_depth must be CORE or FULL" });
    return;
  }

  // --- Verify deal exists and hasn't already been configured ---
  const { data: deal, error: fetchError } = await supabase
    .from("deals")
    .select("id, status, terms_accepted_at")
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

  // --- Update deal ---
  const { error: updateError } = await supabase
    .from("deals")
    .update({
      claim_depth,
      terms_accepted_at: new Date().toISOString(),
      status: "configured",
    })
    .eq("id", id);

  if (updateError) {
    console.error("[deals] Failed to update deal:", updateError);
    res.status(500).json({ error: "Failed to configure deal" });
    return;
  }

  console.log(`[deals] Deal ${id} configured: ${claim_depth}, terms accepted`);

  // TODO: Create Stripe PaymentIntent with capture_method: 'manual'
  // TODO: Return client_secret to frontend for Stripe Elements / redirect to Checkout

  res.json({
    deal_id: id,
    claim_depth,
    status: "configured",
    // stripe_client_secret will go here once Stripe is wired in
  });
});
