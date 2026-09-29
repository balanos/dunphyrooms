// stripe-webhook
// Stripe calls this automatically when something happens. It is what
// makes verification automatic: when Stripe confirms an ID, this marks
// the host as verified in the database, and their listings get the badge.
//
// IMPORTANT: turn OFF "Verify JWT" / "Enforce JWT verification" for this
// function in Supabase — Stripe doesn't sign in. Security comes from
// checking Stripe's signature below instead.
//
// Secrets needed: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//
// Stripe webhook events to send here:
//   checkout.session.completed
//   invoice.paid
//   identity.verification_session.verified
//   identity.verification_session.requires_input

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BOOST_DAYS = 8; // one week, plus a day's grace while the renewal payment goes through
const ATTEMPTS_PER_PAYMENT = 3;

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

// Give a host their paid (or free-with-Boost) ID check
async function grantIdCheck(userId: string) {
  const { data: p } = await admin
    .from("profiles")
    .select("id_verified, id_paid")
    .eq("id", userId)
    .single();
  if (!p || p.id_verified || p.id_paid) return;
  await admin
    .from("profiles")
    .update({ id_paid: true, id_attempts_left: ATTEMPTS_PER_PAYMENT })
    .eq("id", userId);
}

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error("Webhook signature check failed", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      // A payment finished
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const md = s.metadata ?? {};
        if (!md.user_id) break;

        if (md.product === "id" && s.payment_status === "paid") {
          await grantIdCheck(md.user_id);
        }

        if (md.product === "boost" && md.listing_id) {
          const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
          await admin
            .from("listings")
            .update({ boost_until: inDays(BOOST_DAYS), stripe_subscription_id: subId ?? null })
            .eq("id", md.listing_id)
            .eq("host_id", md.user_id);
          await grantIdCheck(md.user_id); // Boost includes a free ID check
        }
        break;
      }

      // A weekly Boost renewal was paid: extend it another week.
      // If the host cancels, renewals stop and the boost simply runs out.
      case "invoice.paid": {
        // deno-lint-ignore no-explicit-any
        const inv = event.data.object as any;
        const sub = inv.subscription ?? inv.parent?.subscription_details?.subscription;
        const subId = typeof sub === "string" ? sub : sub?.id;
        if (subId && inv.billing_reason === "subscription_cycle") {
          await admin
            .from("listings")
            .update({ boost_until: inDays(BOOST_DAYS) })
            .eq("stripe_subscription_id", subId);
        }
        break;
      }

      // Stripe confirmed the ID and selfie match
      case "identity.verification_session.verified": {
        const vs = event.data.object as Stripe.Identity.VerificationSession;
        const userId = vs.metadata?.user_id;
        if (!userId) break;
        await admin
          .from("profiles")
          .update({
            id_verified: true,
            id_verified_at: new Date().toISOString(),
            last_verification_error: null,
          })
          .eq("id", userId);
        break;
      }

      // The check didn't pass (blurry photo, expired ID, face mismatch...)
      case "identity.verification_session.requires_input": {
        const vs = event.data.object as Stripe.Identity.VerificationSession;
        const userId = vs.metadata?.user_id;
        if (!userId || !vs.last_error) break; // no error = they just haven't finished yet
        await admin
          .from("profiles")
          .update({ last_verification_error: vs.last_error.code ?? "not_verified" })
          .eq("id", userId)
          .eq("verification_session_id", vs.id);
        break;
      }
    }
  } catch (err) {
    console.error("Webhook handler error", err);
    return new Response("Handler error", { status: 500 }); // Stripe will retry
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
