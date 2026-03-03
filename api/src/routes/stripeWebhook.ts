import { Router, Request, Response } from "express";
import { stripe } from "../lib/stripe.js";
import { supabase } from "../lib/supabase.js";

export const stripeWebhookRouter = Router();

/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe payment lifecycle events.
 * Uses raw body (not JSON) for signature verification.
 * Raw body middleware is registered in index.ts BEFORE express.json().
 */
stripeWebhookRouter.post("/", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];

  if (!sig || typeof sig !== "string") {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("[stripe] Webhook signature verification failed:", err.message);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  // Acknowledge immediately
  res.json({ received: true });

  try {
    switch (event.type) {
      case "payment_intent.amount_capturable_updated": {
        const pi = event.data.object;
        const dealId = pi.metadata.deal_id;
        const claimDepth = pi.metadata.claim_depth;

        if (!dealId) {
          console.error("[stripe] payment_intent missing deal_id in metadata");
          break;
        }

        console.log(`[stripe] Funds held for deal ${dealId} (${claimDepth}). Triggering pipeline.`);

        await supabase
          .from("deals")
          .update({ status: "pipeline_queued" })
          .eq("id", dealId);

        // -- TRIGGER PIPELINE HERE --
        //
        // The pipeline runner should:
        //   1. Run the EC-CIM two-pass pipeline
        //   2. On abort, check shouldRetry(abortCode) from services/payment.ts
        //   3. If shouldRetry returns true, retry once
        //   4. Call resolvePayment(dealId, result) with the final outcome
        //
        // Example with Inngest:
        //   await inngest.send({ name: "cimscan/pipeline.start", data: { dealId, claimDepth } });
        //
        // Example direct call:
        //   await runPipeline(dealId, claimDepth);

        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        const dealId = pi.metadata.deal_id;
        if (dealId) {
          await supabase
            .from("deals")
            .update({
              status: "payment_failed",
              payment_error: (pi as any).last_payment_error?.message ?? "Unknown error",
            })
            .eq("id", dealId);
        }
        console.log(`[stripe] Payment failed for deal ${dealId}`);
        break;
      }

      case "payment_intent.canceled": {
        const pi = event.data.object;
        console.log(`[stripe] Payment canceled for deal ${pi.metadata.deal_id}`);
        break;
      }

      default:
        console.log(`[stripe] Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error(`[stripe] Webhook handler error (${event.type}):`, err);
  }
});