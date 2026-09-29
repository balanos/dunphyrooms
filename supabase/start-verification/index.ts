// start-verification
// Creates a Stripe Identity verification session for a host who has
// paid for an ID check (or received one free with Boost), and returns
// { url } — Stripe's own secure page where they photograph their ID and
// take a selfie. DunphyRooms never sees or stores the ID images.
//
// Secrets needed: STRIPE_SECRET_KEY, SITE_URL
//   VERIFICATION_FLOW_ID (optional: use a flow you set up in the Stripe Dashboard)
//   ALLOWED_ORIGIN (optional)

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
});
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const SITE_URL = Deno.env.get("SITE_URL")!;
const FLOW_ID = Deno.env.get("VERIFICATION_FLOW_ID");

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Please sign in first." }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile) return json({ error: "Account not found." }, 404);
    if (profile.id_verified) return json({ error: "Your ID is already verified." }, 409);
    if (!profile.id_paid) {
      return json({
        error: "We haven't received your payment confirmation yet. Wait a few seconds and try again.",
      }, 402);
    }
    if (profile.id_attempts_left <= 0) {
      return json({
        error: "You've used all your verification attempts. Please contact support and we'll help.",
      }, 429);
    }

    // Close any earlier unfinished session so only one is open at a time
    if (profile.verification_session_id) {
      try {
        const old = await stripe.identity.verificationSessions.retrieve(profile.verification_session_id);
        if (old.status === "requires_input") {
          await stripe.identity.verificationSessions.cancel(old.id);
        }
      } catch (_) { /* ignore: an old session that can't be cancelled doesn't block a new one */ }
    }

    const checks = FLOW_ID
      ? { verification_flow: FLOW_ID }
      : {
        type: "document" as const,
        options: {
          document: {
            allowed_types: ["driving_license", "passport", "id_card"] as const,
            require_live_capture: true,
            require_matching_selfie: true,
          },
        },
      };

    const session = await stripe.identity.verificationSessions.create({
      ...checks,
      provided_details: { email: user.email },
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      return_url: `${SITE_URL}?view=host&verification=returned`,
    } as Stripe.Identity.VerificationSessionCreateParams);

    await admin
      .from("profiles")
      .update({
        verification_session_id: session.id,
        id_attempts_left: profile.id_attempts_left - 1,
        last_verification_error: null,
      })
      .eq("id", user.id);

    return json({ url: session.url });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't start the ID check. Please try again." }, 500);
  }
});
