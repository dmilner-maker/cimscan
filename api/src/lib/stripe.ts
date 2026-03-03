import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY environment variable is required");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-12-18.acacia" as any,
});

export const PRICING = {
  CORE: {
    amount: 24900, // $249.00
    label: "CIMScan CORE Analysis",
  },
  FULL: {
    amount: 39900, // $399.00
    label: "CIMScan FULL Analysis",
  },
} as const;

export type ClaimDepth = keyof typeof PRICING;