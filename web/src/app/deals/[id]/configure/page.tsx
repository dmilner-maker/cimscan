"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "https://api-production-8be1.up.railway.app";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
);

interface DealInfo {
  id: string;
  deal_name: string;
  sender_email: string;
  filename: string;
  status: string;
  claim_depth: string | null;
  terms_accepted_at: string | null;
  firm_name: string;
  created_at: string;
  pricing: { CORE: number; FULL: number };
}

type ClaimDepth = "CORE" | "FULL";

function formatCents(cents: number): string {
  return "$" + (cents / 100).toFixed(0);
}

function ConfigureForm() {
  const params = useParams();
  const dealId = params.id as string;
  const stripe = useStripe();
  const elements = useElements();

  const [deal, setDeal] = useState<DealInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimDepth, setClaimDepth] = useState<ClaimDepth>("CORE");
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [usePromo, setUsePromo] = useState(false);
  const [promoApplied, setPromoApplied] = useState(false);
  const termsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchDeal() {
      try {
        const res = await fetch(API_URL + "/api/deals/" + dealId);
        if (!res.ok) throw new Error("Deal not found");
        const data = await res.json();
        setDeal(data);
        if (data.terms_accepted_at) {
          setSubmitted(true);
          setClaimDepth(data.claim_depth ?? "CORE");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load deal");
      } finally {
        setLoading(false);
      }
    }
    fetchDeal();
  }, [dealId]);

  const handleTermsScroll = useCallback(() => {
    const el = termsRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
    if (atBottom) setHasScrolledToBottom(true);
  }, []);

  async function handleSubmit() {
    if (!termsAccepted || submitting) return;
    if (usePromo && !promoCode.trim()) return;
    if (!usePromo && (!cardComplete || !stripe || !elements)) return;

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        claim_depth: claimDepth,
        terms_accepted: true,
      };

      if (usePromo) {
        body.promo_code = promoCode.trim();
      } else {
        const cardElement = elements!.getElement(CardElement);
        if (!cardElement) throw new Error("Card element not found");
        const { error: stripeError, paymentMethod } =
          await stripe!.createPaymentMethod({ type: "card", card: cardElement });
        if (stripeError) throw new Error(stripeError.message ?? "Card error");
        body.payment_method_id = paymentMethod.id;
      }

      const res = await fetch(
        API_URL + "/api/deals/" + dealId + "/configure",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Configuration failed");
      }

      const result = await res.json();
      if (result.promo_applied) setPromoApplied(true);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Configuration failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <p className="text-sm text-zinc-500">Loading deal...</p>
      </main>
    );
  }

  if (error && !deal) {
    return (
      <main className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="bg-white rounded-lg border border-zinc-200 p-8 max-w-md text-center">
          <h1 className="text-lg font-semibold text-zinc-900 mb-2">
            Deal Not Found
          </h1>
          <p className="text-sm text-zinc-500">{error}</p>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg border border-zinc-200 p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-zinc-900 mb-2">
            {promoApplied ? "Analysis Queued" : "Payment Authorized"}
          </h1>
          <p className="text-sm text-zinc-500 mb-4">
            <strong>{deal?.deal_name}</strong> has been configured for{" "}
            <strong>{claimDepth}</strong> analysis.
          </p>
          <p className="text-sm text-zinc-400">
            {promoApplied ? (
              <>Your promo code has been applied. Analysis will begin shortly.</>
            ) : (
              <>
                Your card has been authorized for{" "}
                <strong>
                  {deal?.pricing
                    ? formatCents(deal.pricing[claimDepth])
                    : claimDepth}
                </strong>
                . You will only be charged if the analysis completes
                successfully.
              </>
            )}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 py-12 px-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <p className="text-sm font-medium text-zinc-400 tracking-wide uppercase mb-1">
            CIMScan
          </p>
          <h1 className="text-2xl font-semibold text-zinc-900">
            Configure Analysis
          </h1>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 p-6">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">
            Deal Details
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <dt className="text-zinc-500">Deal</dt>
            <dd className="text-zinc-900 font-medium">{deal?.deal_name}</dd>
            <dt className="text-zinc-500">File</dt>
            <dd className="text-zinc-900 font-medium">{deal?.filename}</dd>
            <dt className="text-zinc-500">Firm</dt>
            <dd className="text-zinc-900 font-medium">{deal?.firm_name}</dd>
            <dt className="text-zinc-500">Submitted by</dt>
            <dd className="text-zinc-900 font-medium">
              {deal?.sender_email}
            </dd>
            <dt className="text-zinc-500">Status</dt>
            <dd className="text-zinc-900 font-medium capitalize">
              {deal?.status}
            </dd>
          </dl>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 p-6">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">
            Analysis Depth
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setClaimDepth("CORE")}
              className={
                "text-left p-4 rounded-lg border-2 transition-colors " +
                (claimDepth === "CORE"
                  ? "border-zinc-900 bg-zinc-50"
                  : "border-zinc-200 hover:border-zinc-300")
              }
            >
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-sm font-semibold text-zinc-900">CORE</p>
                <p className="text-sm font-semibold text-zinc-900">
                  {deal?.pricing ? formatCents(deal.pricing.CORE) : "$249"}
                </p>
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                20-30 IC-material claims. Full underwriting-surface coverage.
                Standard diligence scope.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setClaimDepth("FULL")}
              className={
                "text-left p-4 rounded-lg border-2 transition-colors " +
                (claimDepth === "FULL"
                  ? "border-zinc-900 bg-zinc-50"
                  : "border-zinc-200 hover:border-zinc-300")
              }
            >
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-sm font-semibold text-zinc-900">FULL</p>
                <p className="text-sm font-semibold text-zinc-900">
                  {deal?.pricing ? formatCents(deal.pricing.FULL) : "$399"}
                </p>
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                45-60 claims with expanded recall. Second-order operational and
                diligence-relevant claims included.
              </p>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 p-6">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">
            Terms of Use
          </h2>
          <div
            ref={termsRef}
            onScroll={handleTermsScroll}
            className="h-64 overflow-y-auto border border-zinc-200 rounded-lg p-4 text-xs text-zinc-600 leading-relaxed bg-zinc-50"
          >
            <p className="font-semibold text-zinc-900 mb-3">
              CIMScan Terms of Use - True Bearing LLC
            </p>
            <p className="mb-3">
              By configuring and submitting a Confidential Information Memorandum
              (&quot;CIM&quot;) for analysis through CIMScan, you agree to the
              following terms and conditions.
            </p>
            <p className="font-semibold text-zinc-800 mb-2">
              1. Nature of Outputs
            </p>
            <p className="mb-3">
              CIMScan outputs are structured starting points for diligence
              preparation, not investment advice, risk assessments, or
              transaction recommendations. All claims, gate conditions,
              thresholds, and workplan elements are AI-generated and require
              independent validation by qualified professionals before use in any
              investment decision.
            </p>
            <p className="font-semibold text-zinc-800 mb-2">
              2. No Replacement of Professional Judgment
            </p>
            <p className="mb-3">
              CIMScan does not replace the judgment of your deal team, legal
              counsel, or investment committee. Outputs are designed to support
              diligence preparation, not to serve as the basis for investment
              committee decisions without independent verification.
            </p>
            <p className="font-semibold text-zinc-800 mb-2">3. No Warranty</p>
            <p className="mb-3">
              True Bearing LLC makes no representation or warranty that CIMScan
              outputs are complete, accurate, or sufficient for any specific
              transaction or purpose. Outputs may contain errors, omissions, or
              misinterpretations of the source CIM.
            </p>
            <p className="font-semibold text-zinc-800 mb-2">
              4. Limitation of Liability
            </p>
            <p className="mb-3">
              In no event shall True Bearing LLC, its officers, directors,
              employees, or affiliates be liable for any direct, indirect,
              incidental, special, consequential, or exemplary damages arising
              from or related to the use of CIMScan outputs, including but not
              limited to damages for loss of profits, goodwill, data, or other
              intangible losses, even if True Bearing LLC has been advised of the
              possibility of such damages.
            </p>
            <p className="font-semibold text-zinc-800 mb-2">
              5. Confidentiality
            </p>
            <p className="mb-3">
              CIM documents submitted to CIMScan are processed using third-party
              AI infrastructure. While True Bearing LLC takes reasonable measures
              to protect the confidentiality of submitted documents, you
              acknowledge that transmission and processing of documents over the
              internet and through third-party services carries inherent risk.
              You represent that you have the necessary rights and authorizations
              to submit the CIM for AI-powered analysis.
            </p>
            <p className="font-semibold text-zinc-800 mb-2">
              6. Per-Deal Acceptance
            </p>
            <p className="mb-3">
              These terms must be accepted for each CIM submission individually.
              Acceptance for one deal does not constitute acceptance for any
              subsequent deal.
            </p>
            <p className="font-semibold text-zinc-800 mb-2">
              7. Payment and Refunds
            </p>
            <p className="mb-3">
              Payment is authorized at the time of configuration. Your payment
              method is charged only upon successful completion of the analysis
              pipeline. If the pipeline is unable to produce a valid output, the
              payment authorization is released and no charge is applied.
            </p>
            <p className="font-semibold text-zinc-800 mb-2">
              8. Governing Law
            </p>
            <p className="mb-3">
              These terms shall be governed by and construed in accordance with
              the laws of the State of Delaware, without regard to its conflict
              of laws provisions.
            </p>
            <p className="mt-4 text-zinc-400 text-center">
              - End of Terms -
            </p>
          </div>
          {!hasScrolledToBottom && (
            <p className="text-xs text-zinc-400 mt-2 text-center">
              Scroll to the bottom of the terms to enable acceptance.
            </p>
          )}
          <label
            className={
              "flex items-start gap-3 mt-4 " +
              (!hasScrolledToBottom
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer")
            }
          >
            <input
              type="checkbox"
              checked={termsAccepted}
              disabled={!hasScrolledToBottom}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 disabled:opacity-50"
            />
            <span className="text-sm text-zinc-700">
              I have read and accept the Terms of Use for this deal.
            </span>
          </label>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
              Payment
            </h2>
            <button
              type="button"
              onClick={() => {
                setUsePromo(!usePromo);
                setError(null);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-900 underline"
            >
              {usePromo ? "Pay with card instead" : "Have a promo code?"}
            </button>
          </div>

          {usePromo ? (
            <>
              <p className="text-sm text-zinc-500 mb-4">
                Enter your promo code to start analysis at no charge.
              </p>
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="CIMS-XXXX-XXXX"
                className="w-full border border-zinc-200 rounded-lg px-4 py-3 text-sm text-zinc-900 bg-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              />
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-500 mb-4">
                Your card will be authorized for{" "}
                <strong className="text-zinc-900">
                  {deal?.pricing
                    ? formatCents(deal.pricing[claimDepth])
                    : "-"}
                </strong>
                . You are only charged if the analysis completes successfully.
              </p>
              <div className="border border-zinc-200 rounded-lg p-4 bg-zinc-50">
                <CardElement
                  options={{
                    style: {
                      base: {
                        fontSize: "14px",
                        color: "#18181b",
                        "::placeholder": { color: "#a1a1aa" },
                      },
                      invalid: { color: "#dc2626" },
                    },
                  }}
                  onChange={(e) => setCardComplete(e.complete)}
                />
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={
            !termsAccepted ||
            submitting ||
            (usePromo ? !promoCode.trim() : !cardComplete || !stripe)
          }
          className="w-full py-3 px-6 rounded-lg text-sm font-semibold text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting
            ? usePromo
              ? "Applying promo code..."
              : "Authorizing payment..."
            : usePromo
              ? "Start " + claimDepth + " Analysis (Promo)"
              : "Authorize " +
                (deal?.pricing ? formatCents(deal.pricing[claimDepth]) : "") +
                " & Start " +
                claimDepth +
                " Analysis"}
        </button>

        <p className="text-center text-xs text-zinc-400">
          CIMScan by True Bearing LLC
        </p>
      </div>
    </main>
  );
}

export default function ConfigurePage() {
  return (
    <Elements stripe={stripePromise}>
      <ConfigureForm />
    </Elements>
  );
}