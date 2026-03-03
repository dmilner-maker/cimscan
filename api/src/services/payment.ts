import { stripe, PRICING, ClaimDepth } from "../lib/stripe.js";
import { supabase } from "../lib/supabase.js";

// CIM_ERR_041 = Quality Gate fail → skip retry, release immediately
// All other aborts → retry pipeline once, then release if retry fails
// No partial charges. Clean completion = capture. Everything else = release.

const SKIP_RETRY = new Set([
  "CIM_ERR_041",
]);


export async function createPaymentAuth(
    dealId: string,
    claimDepth: ClaimDepth,
    userEmail: string,
    firmId: string,
    stripeCustomerId: string | null,
    paymentMethodId: string
  ) {
  const pricing = PRICING[claimDepth];

  // Create or reuse Stripe customer
  let customerId = stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userEmail,
      metadata: { source: "cimscan" },
    });
    customerId = customer.id;

    await supabase
      .from("firms")
      .update({ stripe_customer_id: customerId })
      .eq("id", firmId);
  }

  // Auth only — capture after pipeline completes
  const paymentIntent = await stripe.paymentIntents.create({
    amount: pricing.amount,
    currency: "usd",
    customer: customerId,
    payment_method: paymentMethodId,
    capture_method: "manual",
    confirm: true,
    description: pricing.label,
    metadata: {
      deal_id: dealId,
      claim_depth: claimDepth,
      product: "cimscan",
      ec_cim_version: "1.7.0",
    },
    receipt_email: userEmail,
  });

  await supabase
    .from("deals")
    .update({
      status: "payment_authorized",
      stripe_payment_intent_id: paymentIntent.id,
      claim_depth: claimDepth,
      payment_amount_cents: pricing.amount,
      payment_authorized_at: new Date().toISOString(),
    })
    .eq("id", dealId);

  return { paymentIntent, clientSecret: paymentIntent.client_secret };
}


export async function capturePayment(dealId: string) {
  const { data: deal } = await supabase
    .from("deals")
    .select("stripe_payment_intent_id")
    .eq("id", dealId)
    .single();

  if (!deal?.stripe_payment_intent_id) {
    throw new Error(`No PaymentIntent for deal: ${dealId}`);
  }

  const paymentIntent = await stripe.paymentIntents.capture(deal.stripe_payment_intent_id);

  await supabase
    .from("deals")
    .update({
      status: "completed",
      payment_captured_at: new Date().toISOString(),
    })
    .eq("id", dealId);

  return paymentIntent;
}


export async function releasePayment(dealId: string, abortCode: string, abortReason: string) {
  const { data: deal } = await supabase
    .from("deals")
    .select("stripe_payment_intent_id")
    .eq("id", dealId)
    .single();

  if (!deal?.stripe_payment_intent_id) {
    throw new Error(`No PaymentIntent for deal: ${dealId}`);
  }

  const paymentIntent = await stripe.paymentIntents.cancel(deal.stripe_payment_intent_id, {
    cancellation_reason: "abandoned",
  });

  await supabase
    .from("deals")
    .update({
      status: "aborted_not_charged",
      pipeline_abort_code: abortCode,
      pipeline_abort_reason: abortReason,
      payment_released_at: new Date().toISOString(),
    })
    .eq("id", dealId);

  return paymentIntent;
}


export interface PipelineResult {
  success: boolean;
  abortCode?: string;
  abortReason?: string;
}

/**
 * Should the pipeline retry on this abort code?
 * Returns false for CIM_ERR_041 (Quality Gate fail) — re-running won't help.
 * Returns true for everything else.
 */
export function shouldRetry(abortCode: string): boolean {
  return !SKIP_RETRY.has(abortCode);
}

/**
 * Resolve payment based on final pipeline outcome.
 * Call this AFTER retry logic has been exhausted.
 * Clean completion = capture. Everything else = release.
 */
export async function resolvePayment(dealId: string, result: PipelineResult) {
  if (result.success) {
    console.log(`[payment] Deal ${dealId}: pipeline succeeded. Capturing payment.`);
    return { action: "captured" as const, paymentIntent: await capturePayment(dealId) };
  }

  const abortCode = result.abortCode ?? "UNKNOWN";
  const abortReason = result.abortReason ?? "Unknown pipeline error";

  console.log(`[payment] Deal ${dealId}: pipeline failed (${abortCode}). Releasing payment.`);
  return { action: "released" as const, paymentIntent: await releasePayment(dealId, abortCode, abortReason) };
}