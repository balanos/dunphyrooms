// create-checkout
// Starts a Stripe Checkout payment for either:
//   { product: "id" }                       -> $2.99 one-off ID check
//   { product: "boost", listing_id: "..." } -> $11.99/week Boost (includes a free ID check)
// Returns { url } for the website to redirect to.
//
// Secrets needed (Supabase > Edge Functions > Secrets):
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID_CHECK, STRIPE_PRICE_BOOST, SITE_URL
//   ALLOWED_ORIGIN (optional, e.g. https://your-username.github.io)

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
    // Who is asking?
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Please sign in first." }, 401);

    const { product, listing_id } = await req.json();
    const { data: profile } = await admin
      .from("profiles")
      .select("id_verified, id_paid")
      .eq("id", user.id)
      .single();

    const back = (params: string) => `${SITE_URL}?view=host&${params}`;

    if (product === "id") {
      if (profile?.id_verified) return json({ error: "Your ID is already verified." }, 409);
      if (profile?.id_paid) return json({ error: "You've already paid. Press Start ID check instead." }, 409);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: Deno.env.get("STRIPE_PRICE_ID_CHECK")!, quantity: 1 }],
        customer_email: user.email,
        client_reference_id: user.id,
        metadata: { user_id: user.id, product: "id" },
        success_url: back("checkout=success&product=id"),
        cancel_url: back("checkout=cancelled"),
      });
      return json({ url: session.url });
    }

    if (product === "boost") {
      if (!listing_id) return json({ error: "Missing listing." }, 400);
      const { data: listing } = await admin
        .from("listings")
        .select("id, host_id")
        .eq("id", listing_id)
        .single();
      if (!listing || listing.host_id !== user.id) return json({ error: "Listing not found." }, 404);

      const metadata = { user_id: user.id, product: "boost", listing_id };
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: Deno.env.get("STRIPE_PRICE_BOOST")!, quantity: 1 }],
        customer_email: user.email,
        client_reference_id: user.id,
        metadata,
        subscription_data: { metadata },
        success_url: back("checkout=success&product=boost"),
        cancel_url: back("checkout=cancelled"),
      });
      return json({ url: session.url });
    }

    return json({ error: "Unknown product." }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
