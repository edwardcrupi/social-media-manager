# Social Media Manager

Tracks revenue attributed to social media activity via affiliate/UTM short links, with content-queue management, a real Instagram connection, and fully automated posting: Claude finds trending topics in your niche, drafts a caption, OpenAI generates an image, and it publishes to Instagram on schedule with no manual review step.

See [`PLAN.md`](./PLAN.md) for the full build plan, current status, and remaining phases (TikTok integration, real Instagram insights).

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

`supabase/functions/generate-trend-posts` searches the web for trends in your niche via Claude, drafts a caption, and generates an image for it via OpenAI. It's **off by default** per-user (`automation_settings.auto_posting_enabled = false`) -- turn it on from the Settings page once you've configured a niche description, brand voice, and topic blocklist there.

To deploy it:
```
supabase secrets set ANTHROPIC_API_KEY=<your-key>
supabase secrets set OPENAI_API_KEY=<your-key>
supabase functions deploy generate-trend-posts
```

Both keys need real billing/credits on their respective platforms (platform.openai.com and console.anthropic.com) -- a ChatGPT or Claude.ai/Claude Code subscription does **not** fund these separate developer-API billing pools.

Add a Supabase Cron Job (Edge Function type, `POST`, pointed at `generate-trend-posts`) running **once a day**. It's a separate, much lower-frequency cron than `publish-scheduled-posts` below: generation only needs to run often enough to keep the queue topped up toward each user's `daily_auto_post_cap`, and it already no-ops (skips the Claude/OpenAI calls) once that cap is hit for the day, so running it more often than daily just risks wasted API spend without producing extra posts. Same two things the cron job form needs as `publish-scheduled-posts` (HTTP headers for `apikey`/`Authorization`, since the trigger doesn't send a JWT by default). You can also invoke it manually to test:
```
supabase functions invoke generate-trend-posts
```

Posts land in your content queue with `status: scheduled`, `media_url` set to the generated image (stored in the public `post-images` Storage bucket), and linked to your connected Instagram profile if one exists.

## Auto-publishing to Instagram

`supabase/functions/publish-scheduled-posts` finds posts whose `scheduled_for` has passed (and which have both a linked, connected Instagram profile and a `media_url`) and actually publishes them via Instagram's Content Publishing API -- **no manual review step**, per this project's design: once a post is due, it goes live unattended.

Deploy and schedule it:
```
supabase functions deploy publish-scheduled-posts
```
Then add a Supabase Cron Job (Edge Function type, `POST`, pointed at `publish-scheduled-posts`) running every 15 minutes. Two things the cron job form needs that aren't obvious:
- **HTTP Headers**: add `apikey` and `Authorization: Bearer <your anon/publishable key>` -- the function requires a valid Supabase JWT, and the cron trigger doesn't send one by default.
- **Timeout**: capped at 5000ms by the platform. The function can occasionally take longer than that to finish (Instagram's media-processing step is polled), but the Edge Function keeps running server-side past that timeout regardless -- check `posts.status` in the app, not the cron job's own log, to know if a publish actually succeeded.

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

Current scopes requested: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management`, `instagram_manage_insights`, `instagram_content_publish`. The insights/publish scopes initially failed as "Invalid Scopes" -- not a naming issue, but because Meta's dashboard gates them behind a **Use Case** that has to be added first: My Apps -> Use cases -> Add use cases -> "Manage messaging and content on Instagram". Once added and showing "ready for testing," both scopes work immediately with no App Review needed.

## Auto-generated video Reels (optional)

`supabase/functions/generate-reel-posts` drafts a vertical (9:16) video concept + caption via Claude and submits it to **Seedance 2.5** for generation via **BytePlus ModelArk** -- not Volcano Engine (Seedance's domestic ByteDance platform), which reportedly requires China real-name ID verification international users can't complete. BytePlus is the separate, English-documented, international route to the same model.

Video generation is asynchronous and takes minutes, so this is two functions, not one:
```
supabase secrets set ARK_API_KEY=<your-byteplus-key>
supabase functions deploy generate-reel-posts
supabase functions deploy check-video-jobs
```
- `generate-reel-posts`: drafts the concept and submits the job; the post lands in your queue as `status: generating`. **Before first use**, activate the model in the BytePlus Ark Console (Model Management -> find `dreamina-seedance-2-5-260628` -> activate) -- having an API key alone isn't enough, same shape as OpenAI/Anthropic billing setup.
- `check-video-jobs` (needs its own cron, every 3-5 min): polls for finished jobs, downloads the video into the public `post-videos` bucket, and flips the post to `scheduled` once ready.

Cost is meaningfully higher than image posts (~10-20x per post), so `automation_settings.daily_reel_cap` is deliberately separate from `daily_auto_post_cap` and defaults to 1/day -- adjust it in Settings.

`publish-scheduled-posts` already knows how to publish these as Instagram Reels (`media_type=REELS`) once `check-video-jobs` marks one `scheduled` -- no separate deploy needed for that part, just redeploy `publish-scheduled-posts` if you haven't already picked up that change.

## Connecting Impact for revenue tracking

Revenue attribution beyond click counts works via **Impact** postbacks -- not Amazon Associates, whose 2026 reporting changes removed per-order data entirely and left only a manually-exported, 100-Tracking-ID-capped CSV with no live API for individual associates. Impact's publisher postback is real-time and per-conversion instead.

1. Sign up as an Impact publisher and get accepted into an advertiser program relevant to your niche.
2. Grab that program's tracking link from Impact and paste it as a short link's **destination URL** on the Revenue page, exactly like any other link -- `redirect` automatically appends `subId1=<the short link's slug>` to it, which is how a conversion gets matched back to the right link/post.
3. Set the postback secret and deploy the function:
   ```
   supabase secrets set IMPACT_POSTBACK_TOKEN=<a random value>
   supabase functions deploy impact-conversion-postback --no-verify-jwt
   ```
4. In Impact's dashboard -> Event Notifications, paste this as your postback URL (fill in your own token and project ref):
   ```
   https://stkocgwlqfilsedtrjvy.supabase.co/functions/v1/impact-conversion-postback?token=<IMPACT_POSTBACK_TOKEN>&action_id={ActionId}&subid1={SubId1}&amount={Amount}&payout={Payout}&currency={Currency}&status={Status}&campaign={CampaignName}&event_date={EventDate}
   ```

Conversions land in `revenue_events` with `status: pending`, `confirmed`, or `reversed` (Impact notifies again as a conversion's status changes -- the same action updates in place rather than creating duplicates). The Revenue page excludes `reversed` events from the chart and flags `pending` ones inline.

## Scripts

- `npm run dev` -- start the dev server
- `npm run build` -- type-check and build for production
- `npm run lint` -- run oxlint
- `npm run preview` -- preview the production build locally
