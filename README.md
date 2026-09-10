# Social Media Manager

Tracks revenue attributed to social media activity via affiliate/UTM short links, with content-queue management and a real Instagram connection (manual entry for other platforms/TikTok for now).

See `/Users/edwardcrupi/.claude/plans/modular-fluttering-newt.md` for the full build plan and roadmap.

## Setup

1. Create a Supabase project at [supabase.com](https://supabase.com) (free tier is fine).
2. Copy `.env.local.example` to `.env.local` and fill in your project's URL and anon key (Supabase dashboard -> Project Settings -> API):
   ```
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   ```
3. Run the schema migration against your project: open the Supabase SQL editor and paste the contents of `supabase/migrations/0001_init.sql`, or use the CLI:
   ```
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
4. Enable email OTP sign-in: it's on by default under Authentication -> Providers -> Email in the Supabase dashboard.
5. Install dependencies and run the app:
   ```
   npm install
   npm run dev
   ```

Sign in with your email (you'll get a magic link) and you're in.

## Auto-drafted posts from trending topics (optional)

`supabase/functions/generate-trend-posts` searches the web for trends in your niche via Claude and drafts posts automatically. It's **off by default** per-user (`automation_settings.auto_posting_enabled = false`) -- turn it on from the Settings page once you've configured a niche description, brand voice, and topic blocklist there.

To deploy it:
```
supabase secrets set ANTHROPIC_API_KEY=<your-key>
supabase functions deploy generate-trend-posts
```

Then add a scheduled trigger (Supabase Dashboard -> Cron Jobs, or `pg_cron` + `pg_net`) to call the deployed function URL with `POST` on whatever cadence you want (e.g. daily). You can also invoke it manually to test:
```
supabase functions invoke generate-trend-posts
```

**Note**: posts it creates land in your content queue with `status: scheduled` -- they don't reach Instagram/TikTok on their own yet. Actual auto-publishing depends on the publish scopes/function noted in the Instagram section below.

## Connecting Instagram

The Profiles page has a **Connect Instagram** button that runs a real Facebook Login for Business OAuth flow against a Page-linked Instagram Business/Creator account. No App Review needed as long as you're connecting your own account (as a tester/admin on your Meta app) rather than other people's.

One-time setup:

1. Convert the Instagram account to **Business** (Instagram Settings -> Account type and tools) and link it to a **Facebook Page** you admin (Facebook Page -> Settings -> Linked Accounts -> Connect Account -- if the connect popup is blank, try the mobile apps instead, it's more reliable than desktop).
2. Create a Meta app at [developers.facebook.com](https://developers.facebook.com) (Business type), add the **Instagram** product, and add **Facebook Login for Business** as its own product too.
3. In the Meta app's **Settings -> Basic**, add the bare domain to **App Domains** (e.g. `stkocgwlqfilsedtrjvy.supabase.co` -- no `https://`, no path).
4. In **Facebook Login for Business -> Settings**, add the full callback URL to **Valid OAuth Redirect URIs**:
   ```
   https://stkocgwlqfilsedtrjvy.supabase.co/functions/v1/instagram-oauth-callback
   ```
5. Add yourself as a tester/admin on the app (App roles -> Roles) and accept the invite Instagram sends you.
6. Get the App ID and App Secret from **Settings -> Basic**, then set secrets and deploy both functions:
   ```
   supabase secrets set \
     META_APP_ID=<app-id> \
     META_APP_SECRET=<app-secret> \
     META_REDIRECT_URI=https://stkocgwlqfilsedtrjvy.supabase.co/functions/v1/instagram-oauth-callback \
     APP_URL=http://localhost:5183

   supabase functions deploy instagram-oauth-start
   supabase functions deploy instagram-oauth-callback --no-verify-jwt
   ```

Current scopes requested: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management` -- enough for the connection itself and basic profile/follower data. `instagram_manage_insights` and `instagram_content_publish` are rejected as invalid by this flow's product configuration as currently set up; real insights and auto-publishing need that sorted out first (see the plan file's Phase 4 notes for what's been ruled out so far).

## Scripts

- `npm run dev` -- start the dev server
- `npm run build` -- type-check and build for production
- `npm run lint` -- run oxlint
- `npm run preview` -- preview the production build locally
