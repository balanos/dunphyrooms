# DunphyRooms: switching on the backend

This folder contains your website plus the backend that makes Stripe ID checks automatic.
Everything is done through websites (Supabase, Stripe, GitHub). You don't need to install anything.

Allow about an hour the first time. **Do everything in Stripe's test mode first**, so no real money moves while you check it works.

## What's in the folder

| File | What it is |
|---|---|
| `index.html` | The website. Upload this to GitHub as before. |
| `admin.html` | Your private admin page for approving and removing listings. Upload it to GitHub next to `index.html`. |
| `supabase/schema.sql` | Creates your database tables and security rules. |
| `supabase/admin.sql` | Adds the admin list and lets admins review listings. Run after `schema.sql`. |
| `supabase/functions/create-checkout/index.ts` | Starts a Stripe payment ($2.99 ID check, or $11.99/week Boost). |
| `supabase/functions/start-verification/index.ts` | Opens Stripe's ID check for a host who has paid. |
| `supabase/functions/stripe-webhook/index.ts` | Stripe calls this when an ID passes, which marks the host verified automatically. |
| `supabase/functions/admin-review/index.ts` | Approves, removes or restores a listing when you press the buttons on `admin.html`. |

## How it works once set up

1. Anyone can create an account with their email and a password using the **Log in** button. The same account works for renting and hosting, and My RenterResume and List a room need an account.
2. They upload ownership proof and photos. These go into private storage that only you can see.
3. They either pay $2.99 for an ID check, or publish with Boost ($11.99/week), which unlocks the ID check for free.
4. They press **Start ID check** and go to Stripe's page, where they photograph their licence or passport and take a selfie.
5. Stripe sends the result to your webhook. The host's account is marked verified, and every listing of theirs shows the ID-verified badge and ranks higher.
6. You check each new listing's ownership documents and photos on `admin.html` and press **Approve**. It then appears in search. Scam listings get **Remove**.

DunphyRooms never receives or stores the ID images. Stripe keeps them, and your database only stores "verified: yes/no".

---

## Step 1: Create a Supabase project

1. Go to [supabase.com](https://supabase.com), sign up (free), and click **New project**.
2. Name it `dunphyrooms`, set a strong database password (save it somewhere), and pick the **Sydney** region.
3. Wait a minute or two for it to finish setting up.

## Step 2: Create the database

1. In your Supabase project, open **SQL Editor** in the left sidebar, then click **New query**.
2. Open `supabase/schema.sql` from this folder, copy everything in it, paste it in, and click **Run**. If Supabase warns about "destructive operations", click **Run this query**. That's expected.
3. You should see "Success. No rows returned".
4. Open another **New query**, paste in everything from `supabase/admin.sql`, and click **Run**. You'll make yourself an admin in Step 10, once you have an account on the site.

## Step 3: Set up account emails

1. Go to **Authentication > URL Configuration**.
2. Set **Site URL** to your GitHub Pages address, for example `https://your-username.github.io/dunphyrooms/`.
3. Under **Redirect URLs**, add the same address followed by `**`, for example `https://your-username.github.io/dunphyrooms/**`.
4. Go to **Authentication > Sign In / Providers** and check that **Email** is enabled. Leave **Confirm email** on, so new accounts must click a link in their inbox before they can log in. This stops people signing up with other people's email addresses.

These addresses are where the "confirm your account" and "reset your password" email links send people back to.

Supabase's built-in email sender only sends a few emails per hour. That's fine for testing. Before launch, set up your own email provider under **Authentication > Emails > SMTP Settings** (Resend and Postmark both have free tiers).

## Step 4: Set up Stripe

Make sure the **Test mode** switch in the Stripe Dashboard is on.

1. **Turn on Identity:** go to [dashboard.stripe.com/identity](https://dashboard.stripe.com/identity) and follow the steps to activate it.
2. **Create the ID check product:** go to **Product catalogue > Add product**. Name it "Host ID check", price **$2.99 AUD**, **One-off**. Save it, then copy its **price ID** (starts with `price_`).
3. **Create the Boost product:** add another product called "Boost listing", price **$11.99 AUD**, **Recurring**, billing period **Weekly**. Copy its price ID too.
4. **Copy your secret key:** go to **Developers > API keys** and copy the **Secret key** (starts with `sk_test_`). Keep this private. It must never go in `index.html` or on GitHub.

## Step 5: Add the four server functions

For each of the four functions, do this in Supabase:

1. Go to **Edge Functions**, click **Deploy a new function**, and choose **Via Editor**.
2. Name it **exactly** as below, delete the example code, paste in the contents of the matching file, and click **Deploy**.

| Function name | File to paste |
|---|---|
| `create-checkout` | `supabase/functions/create-checkout/index.ts` |
| `start-verification` | `supabase/functions/start-verification/index.ts` |
| `stripe-webhook` | `supabase/functions/stripe-webhook/index.ts` |
| `admin-review` | `supabase/functions/admin-review/index.ts` |

3. **For `stripe-webhook` only:** open the function's **Details** or settings, and turn **off** "Verify JWT" (it may be called "Enforce JWT verification"). Stripe can't sign in to your site, so this has to be off. The function checks Stripe's digital signature instead, so it's still secure.

## Step 6: Connect Stripe's webhook

1. In Stripe, go to **Developers > Webhooks** (sometimes shown as **Workbench > Webhooks**) and click **Add destination** or **Add endpoint**.
2. Endpoint URL: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/stripe-webhook`
   (Your project ref is the random letters in your Supabase project address.)
3. Choose these four events:
   - `checkout.session.completed`
   - `invoice.paid`
   - `identity.verification_session.verified`
   - `identity.verification_session.requires_input`
4. Save, then reveal and copy the **Signing secret** (starts with `whsec_`).

## Step 7: Add your secrets to Supabase

Go to **Edge Functions > Secrets** (or **Project Settings > Edge Functions**) and add each of these:

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Your `sk_test_...` key from Step 4 |
| `STRIPE_PRICE_ID_CHECK` | The $2.99 price ID (`price_...`) |
| `STRIPE_PRICE_BOOST` | The $11.99/week price ID (`price_...`) |
| `STRIPE_WEBHOOK_SECRET` | The `whsec_...` secret from Step 6 |
| `SITE_URL` | Your site address, e.g. `https://your-username.github.io/dunphyrooms/` |
| `ALLOWED_ORIGIN` | Just the domain, e.g. `https://your-username.github.io` (no folder, no slash at the end) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the functions automatically, so you don't add them.

## Step 8: Connect the website

1. In Supabase, go to **Project Settings > API** (or **API Keys**). Copy the **Project URL** and the **anon** / **publishable** key.
2. Open `index.html` in a text editor, or edit it on GitHub with the pencil icon. Search for `BACKEND SETTINGS`, then fill in:
   ```js
   SUPABASE_URL:"https://abcdefgh.supabase.co",
   SUPABASE_ANON_KEY:"eyJ...or sb_publishable_...",
   ```
   These two values are designed to be public. Never paste the `service_role` key or a Stripe `sk_` key here.
3. Do the same in `admin.html`: search for `BACKEND SETTINGS` and paste in the **same two values**.
4. Upload both `index.html` and `admin.html` to your GitHub repository.

If these two values are left blank, the site keeps working in demo mode with simulated checks.

## Step 9: Test it

1. Open your GitHub Pages site and click **Log in**, then **Create account**. Use your own email, click the confirmation link in your inbox, then go to **List a room**.
2. Upload any image as ownership proof and photos, then press **Pay $2.99 and verify**.
3. On Stripe's test checkout, pay with card `4242 4242 4242 4242`, any future expiry date, and any CVC.
4. Back on your site, press **Start ID check**. Stripe's test mode lets you choose a result instead of using a real ID. Choose the successful one.
5. Within about a minute, your site should show **ID confirmed by Stripe**. In Supabase **Table Editor > profiles**, `id_verified` should now be ticked.

If something doesn't work, check **Edge Functions > (function name) > Logs** in Supabase, and **Developers > Webhooks > (your endpoint)** in Stripe, which shows whether Stripe's messages were delivered.

## Step 10: Your admin page (approving and removing listings)

New listings stay hidden from search until you approve them. You do this on your private admin page.

**One-time setup: make yourself an admin**

1. On your website, create an account (**Log in > Create account**) with your business email and click the confirmation link.
2. In Supabase, open **SQL Editor > New query** and paste this, with your email in the quotes:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'your-business-email@example.com';
   ```
3. Click **Run**. You should see "Success. 1 row affected". If it says 0 rows, the email doesn't match an account.

To add a co-founder or staff member later, run the same two lines with their email.

**Reviewing listings**

1. Open `https://your-username.github.io/dunphyrooms/admin.html` and log in with your normal account. Bookmark it. It isn't linked from the public site.
2. The **Waiting for review** tab lists new listings, oldest first. For each one:
   - Click **Show ownership documents and photos**, and check that the name on the ownership proof matches the host and that the photos look real.
   - Check any **"This host has N active listings"** warning for duplicates of the same room.
   - Click **Approve and make live** if everything checks out. It appears in search straight away.
   - Otherwise click **Remove listing**, pick or type a reason, and confirm. The host can't undo this. If the listing was boosted, its Boost subscription is cancelled automatically so the host isn't charged again.
3. The **Removed** tab keeps removed listings with their reasons. **Restore listing** puts one back if you removed it by mistake (it doesn't restart a cancelled Boost).

Anyone can load the `admin.html` page, but it's useless to them. Without an account on your admin list, the database refuses to show them anything, and the server function refuses every button press.

## Going live with real payments

1. Complete your Stripe account activation (business details and bank account).
2. Turn off test mode. Recreate the two products and the webhook in live mode, because test and live are separate.
3. In Supabase secrets, replace `STRIPE_SECRET_KEY`, both price IDs and `STRIPE_WEBHOOK_SECRET` with the live versions.

Check Stripe's current Identity price per verification (listed on Stripe's Identity pricing page) against your $2.99 fee, and budget for the free checks included with Boost.

## Not automated yet

- **Renter applications, RenterResumes and the renter $5.99 paywall** still live in each visitor's browser. That's the next backend piece to build.
- **Auto-pausing listings after 72 hours without a reply** needs a scheduled job once applications are stored in the database.
- **Ownership and photo checks** are manual review by you on the admin page, as described in Step 10.
- **Refunds for removed Boost listings.** Removing a listing cancels future Boost charges, but doesn't refund the current week. Issue a refund in the Stripe Dashboard if you think it's fair.
