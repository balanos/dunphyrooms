// admin-review
// Lets an admin approve, remove or restore a listing from admin.html.
//
// Request body: { listing_id: "...", action: "approve" | "remove" | "restore", reason?: "..." }
//
//   approve -> marks ownership and photos as checked and makes the listing live
//   remove  -> hides the listing for good (the host can't undo it), saves the
//              reason, and cancels its Boost subscription so the host isn't
//              charged again
//   restore -> puts a removed listing back live (e.g. if removed by mistake).
//              It does NOT restart a cancelled Boost.
//
// Secrets needed: STRIPE_SECRET_KEY (already set for the other functions)
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
    // 1. Who is asking, and are they on the admin list?
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Please log in." }, 401);

    const { data: isAdmin } = await admin
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!isAdmin) return json({ error: "This account isn't an admin." }, 403);

    // 2. What do they want to do?
    const { listing_id, action, reason } = await req.json();
    if (typeof listing_id !== "string" || !listing_id) return json({ error: "Missing listing." }, 400);

    const { data: listing } = await admin
      .from("listings")
      .select("id, status, stripe_subscription_id, boost_until")
      .eq("id", listing_id)
      .maybeSingle();
    if (!listing) return json({ error: "Listing not found." }, 404);

    const stamp = { reviewed_at: new Date().toISOString(), reviewed_by: user.id };
    let boostCancelled = false;
    let warning: string | null = null;

    if (action === "approve") {
      if (listing.status === "removed") {
        return json({ error: "This listing was removed. Restore it instead." }, 409);
      }
      await update(listing_id, {
        ...stamp,
        own_verified: true,
        photos_verified: true,
        status: "active",
        review_note: null,
      });
    } else if (action === "remove") {
      const note = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
      if (!note) return json({ error: "Please give a reason for removing this listing." }, 400);

      // Stop the host being charged for Boost on a listing that's gone
      if (listing.stripe_subscription_id) {
        try {
          const sub = await stripe.subscriptions.retrieve(listing.stripe_subscription_id);
          if (sub.status !== "canceled") {
            await stripe.subscriptions.cancel(listing.stripe_subscription_id);
          }
          boostCancelled = true;
        } catch (err) {
          console.error("Couldn't cancel Boost subscription", err);
          warning =
            "The listing was removed, but its Boost subscription couldn't be cancelled automatically. " +
            "Cancel it in the Stripe Dashboard under Subscriptions.";
        }
      }
      await update(listing_id, {
        ...stamp,
        status: "removed",
        review_note: note,
        boost_until: null,
      });
    } else if (action === "restore") {
      await update(listing_id, { ...stamp, status: "active", review_note: null });
    } else {
      return json({ error: "Unknown action." }, 400);
    }

    return json({ ok: true, boostCancelled, warning });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});

async function update(id: string, fields: Record<string, unknown>) {
  const { error } = await admin.from("listings").update(fields).eq("id", id);
  if (error) throw error;
}
