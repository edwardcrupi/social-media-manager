# Social Media Manager

Tracks revenue attributed to social media activity via affiliate/UTM short links, with content-queue management, real Instagram, TikTok, X, and Facebook connections, and fully automated posting: Claude finds trending topics in your niche, drafts a caption, OpenAI/Seedance generates the image or video, and it publishes on schedule to every connected platform with no manual review step.

See [`PLAN.md`](./PLAN.md) for the full build plan and current status.

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

Posts land in your content queue with `status: scheduled`, `media_url` set to the generated image (stored in the public `post-images` Storage bucket). The image is generated once per idea, then **fanned out to one post row per connected, image-capable platform** (Instagram, X, and Facebook -- TikTok has no image posting) -- if you have all three connected, one idea becomes three identically-imaged queue rows, one per platform. `daily_auto_post_cap` counts distinct ideas, not rows, so connecting another platform doesn't divide up how many ideas you get per day. The video/Reel equivalent (`generate-reel-posts`) fans out the same way across Instagram, TikTok, X, and Facebook.

## Auto-publishing to Instagram, TikTok, X, and Facebook

`supabase/functions/publish-scheduled-posts` finds posts whose `scheduled_for` has passed (and which have both a linked, connected social profile and a `media_url`) and actually publishes them -- via Instagram's Content Publishing API, TikTok's Content Posting API, X's tweet + media APIs, or a direct post to a Facebook Page's `/photos`/`/videos` endpoint, depending on the post's platform -- **no manual review step**, per this project's design: once a post is due, it goes live unattended.

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

## Connecting Facebook

The Profiles page has a **Connect Facebook** button that connects a Facebook Page you admin directly (not an Instagram account) and publishes to that Page's feed. It reuses the same Meta app as Instagram -- no separate app needed -- but needs its own redirect URI, since Meta requires an exact registered match per callback URL, plus its own scope for posting.

One-time setup (assuming you've already created the Meta app for Instagram above):

1. In **Facebook Login for Business -> Settings**, add this callback URL to **Valid OAuth Redirect URIs** alongside the Instagram one:
   ```
   https://stkocgwlqfilsedtrjvy.supabase.co/functions/v1/facebook-oauth-callback
   ```
2. Set the extra secret and deploy both functions:
   ```
   supabase secrets set FACEBOOK_REDIRECT_URI=https://stkocgwlqfilsedtrjvy.supabase.co/functions/v1/facebook-oauth-callback

   supabase functions deploy facebook-oauth-start
   supabase functions deploy facebook-oauth-callback --no-verify-jwt
   ```

Scopes requested: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` -- `pages_manage_posts` is the one Instagram's flow doesn't need, since Instagram only reads the Page to find the linked Instagram Business Account rather than posting to the Page itself.

The connected profile stores the Page's own id as `external_id` and the Page access token as its secret (the same kind of token Instagram's flow already gets from `/me/accounts` and stores per-profile) -- `publish-scheduled-posts` posts straight to `/{page-id}/photos` or `/{page-id}/videos` with that token, no App Review needed for posting to a Page you admin yourself.

## Auto-generated video Reels (optional)

`supabase/functions/generate-reel-posts` drafts a vertical (9:16) video concept + caption via Claude and submits it to **Seedance 2.5** for generation via **BytePlus ModelArk** -- not Volcano Engine (Seedance's domestic ByteDance platform), which reportedly requires China real-name ID verification international users can't complete. BytePlus is the separate, English-documented, international route to the same model.

Video generation is asynchronous and takes minutes, so this is two functions, not one:
```
supabase secrets set ARK_API_KEY=<your-byteplus-key>
supabase functions deploy generate-reel-posts
supabase functions deploy check-video-jobs
```
- `generate-reel-posts` (needs its own cron, **once a day**, same reasoning as `generate-trend-posts`: it only needs to keep the queue topped up toward `daily_reel_cap` and already no-ops once that cap is hit for the day): drafts the concept and submits the job; the post lands in your queue as `status: generating`. **Before first use**, activate the model in the BytePlus Ark Console (Model Management -> find `dreamina-seedance-2-5-260628` -> activate) -- having an API key alone isn't enough, same shape as OpenAI/Anthropic billing setup.
- `check-video-jobs` (needs its own separate cron, every 3-5 min): polls for finished jobs, downloads the video into the public `post-videos` bucket, and flips the post to `scheduled` once ready.

Both crons need the same setup as `publish-scheduled-posts` above: Edge Function type, `POST`, with `apikey`/`Authorization: Bearer <anon key>` HTTP headers (the trigger doesn't send a JWT by default).

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

## Connecting TikTok

The Profiles page has a **Connect TikTok** button that runs a TikTok Login Kit OAuth flow (same `oauth_states` table as Instagram, `provider = 'tiktok'`).

One-time setup:

1. Create an app at [developers.tiktok.com](https://developers.tiktok.com), add the **Login Kit** and **Content Posting API** products.
2. **Click "Create Sandbox"** (the tab next to Production) and do the rest of this setup against the Sandbox version -- a Production app in unreviewed "Draft" status cannot complete any OAuth login at all, even for your own account. The Sandbox has its **own separate Client Key/Secret** from Production; use those while testing.
3. Add your callback URL under the Sandbox's Login Kit redirect URIs:
   ```
   https://stkocgwlqfilsedtrjvy.supabase.co/functions/v1/tiktok-oauth-callback
   ```
4. Add `user.info.basic`, `user.info.stats`, and `video.publish` under Scopes (they only appear once Login Kit and Content Posting API are added as products), add your own TikTok account under Sandbox settings -> Target users, fill in the required Basic Info fields (icon, category, description, a Terms of Service/Privacy Policy URL, and the **Web** platform checkbox), then click **Apply changes** -- nothing above takes effect until you do.
5. Under the Content Posting API product, verify the domain your video files are served from (the Supabase Storage `post-videos` bucket's public URL host) as a **URL Prefix** -- required before `PULL_FROM_URL` publishing will work, the TikTok equivalent of Meta's App Domains step. This is a "signature file" verification: TikTok gives you a filename + content and checks for it *nested one path segment under the exact registered URL*, appending a trailing slash regardless of what the URL looks like (so verifying `.../post-videos/` means hosting the file at `.../post-videos/<filename>`).
6. **Set your own TikTok account to Private** (in the TikTok app: Profile -> Settings and privacy -> Privacy -> Private account). Unaudited apps can only post to private accounts, regardless of the `privacy_level` sent on the post itself -- publishing fails with `unaudited_client_can_only_post_to_private_accounts` otherwise.
7. Get the Sandbox's Client Key and Client Secret, set secrets, and deploy:
   ```
   supabase secrets set \
     TIKTOK_CLIENT_KEY=<client-key> \
     TIKTOK_CLIENT_SECRET=<client-secret> \
     TIKTOK_REDIRECT_URI=https://stkocgwlqfilsedtrjvy.supabase.co/functions/v1/tiktok-oauth-callback

   supabase functions deploy tiktok-oauth-start
   supabase functions deploy tiktok-oauth-callback --no-verify-jwt
   supabase functions deploy publish-scheduled-posts
   ```

Scopes requested: `user.info.basic`, `user.info.stats`, `video.publish`. `username` is deliberately not requested -- it needs the separate `user.info.profile` scope, its own review step -- so the connected profile's handle falls back to `display_name`.

**Important limitation**: TikTok gates public posting via the Content Posting API behind its own app audit, separate from Login Kit approval. Until that audit is granted, posts publish with `privacy_level: SELF_ONLY` (visible only to the connected account) -- set the `TIKTOK_PRIVACY_LEVEL` secret to `PUBLIC_TO_EVERYONE` once TikTok approves the app for public posting. This directly cuts against the "fully unattended" design goal: until audited, a TikTok "auto-publish" only reaches the connected account itself, not the public. `publish-scheduled-posts` also queries TikTok's Creator Info endpoint before every publish and uses only the `privacy_level` it reports as actually allowed for that account -- required by TikTok's Content Posting API, not optional.

To move beyond `SELF_ONLY`: submit the **Production** app (not Sandbox) for TikTok's App Review, requesting the Content Posting API's public-posting audit. It needs the same Basic Info/Scopes/Products setup as the Sandbox app above, plus a demo video showing the real end-to-end connect-and-publish flow and a written explanation of how each scope is used. Once approved, switch `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` to Production's credentials and set `TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE`.

TikTok access tokens expire after 24h (vs. Instagram's ~60 days); `publish-scheduled-posts` refreshes them automatically using the stored `refresh_token` (valid ~365 days) whenever fewer than 5 minutes remain, so no separate refresh cron is needed.

TikTok reuses the existing Reels video-generation pipeline (Phase 6/`generate-reel-posts`) -- any post whose `social_profile_id` points at a connected TikTok profile publishes there instead of Instagram, same content, same `media_url`.

## Connecting X

The Profiles page has a **Connect X** button that runs an OAuth 2.0 Authorization Code + PKCE flow (same `oauth_states` table as Instagram/TikTok, `provider = 'x'`, plus a `code_verifier` column PKCE needs that the other two flows don't).

**Cost note before you start**: X retired its free API tier in Feb 2026. Posting is pay-per-use -- **$0.015 per plain tweet, $0.20 per tweet containing a URL** -- billed to a payment method you add in the Developer Portal. This app's auto-posting has no review step, so every scheduled X post is a real, small charge; keep `daily_auto_post_cap`/`daily_reel_cap` sane.

One-time setup:

1. Create a project + app at [developer.x.com](https://developer.x.com). **Make sure the Project has full API access, not "MCP access only"** -- X's portal offers a separate, limited Project tier scoped to their MCP server. Credentials from an MCP-only Project pass OAuth token exchange fine but fail every actual API call (`/2/users/me`, `/2/tweets`, ...) with a misleading error that reads like a Project-attachment problem (`"...you must use keys and tokens from a developer App that is attached to a Project"`) when the real issue is the Project's access *type*. If you hit that error with a Project you're sure is correctly attached, this is why -- check the Project's access level, not the App. Under the app's **User authentication settings**, turn on **OAuth 2.0**, set **Type of App** to a confidential type (e.g. "Web App, Automated App or Bot") -- this is what gets you a Client Secret; a public client won't work with the server-side token exchange this app does. Set **App permissions** to **Read and Write** (required for `tweet.write` to be grantable at all).
2. Add your callback URL under **Redirect URI / Callback URLs**:
   ```
   https://stkocgwlqfilsedtrjvy.supabase.co/functions/v1/x-oauth-callback
   ```
3. Add a payment method under the Developer Portal's billing settings -- required before any write call succeeds, independent of OAuth working.
4. Get the app's Client ID and Client Secret (App settings -> Keys and tokens -> OAuth 2.0 Client ID and Client Secret), set secrets, and deploy:
   ```
   supabase secrets set \
     X_CLIENT_ID=<client-id> \
     X_CLIENT_SECRET=<client-secret> \
     X_REDIRECT_URI=https://stkocgwlqfilsedtrjvy.supabase.co/functions/v1/x-oauth-callback

   supabase functions deploy x-oauth-start
   supabase functions deploy x-oauth-callback --no-verify-jwt
   supabase functions deploy publish-scheduled-posts
   supabase functions deploy generate-trend-posts
   supabase functions deploy generate-reel-posts
   supabase functions deploy check-video-jobs
   ```

Scopes requested: `tweet.read`, `tweet.write`, `users.read`, `offline.access` (for the refresh token -- X access tokens last ~2h), `media.write` (for the chunked media upload endpoint, separate from `tweet.write`).

X posts reuse the same generated image/Reel content as Instagram/TikTok (see the fan-out note above) -- the caption is truncated to 280 characters if needed. Media upload is X's three-step chunked flow (`/2/media/upload/initialize` -> `/append` -> `/finalize`, polling `?command=STATUS` for video) followed by `POST /2/tweets` with the resulting `media_ids`.

**Confirmed working against a real account** (2026-09-16): OAuth connect and an image publish both verified end-to-end against `@AIUniverseNewsX` -- a real tweet published with media via the chunked upload path, `platform_media_id` populated with the real tweet id. Still unverified: a video post through the same path, and whether `refresh_token` actually rotates on refresh as assumed in `refreshXTokenIfNeeded`. See `PLAN.md`'s Phase 10 section for details.

## Real Instagram insights

`supabase/functions/sync-instagram-insights` pulls actual reach/engagement data from the Graph API's insights endpoints for every connected Instagram account, and writes it into a new `platform_metrics` table -- the Insights page now renders this instead of only aggregates computed from local `posts`/`revenue_events`.

Deploy and schedule it:
```
supabase functions deploy sync-instagram-insights
```
Add a Supabase Cron Job (Edge Function type, `POST`, pointed at `sync-instagram-insights`) running **hourly** -- Instagram's own insights data doesn't refresh faster than that, so there's no benefit to a tighter cadence. Same HTTP headers requirement as the other cron jobs (`apikey` + `Authorization: Bearer <anon key>`). No new secrets needed -- it reuses each profile's already-stored access token.

It pulls two kinds of metrics:
- **Account-level**: `reach` via the time-series insights endpoint (`metric_type=time_series`); `profile_views`, `accounts_engaged`, `total_interactions` via the total-value endpoint (`metric_type=total_value`) -- these three 400 under `time_series`, confirmed against the real Graph API.
- **Per-post** (`reach`, `likes`, `comments`, `saved`, `shares`, plus `views`/`total_interactions` for Reels), via each published post's own `platform_media_id` -- newly stored on the `posts` row by `publish-scheduled-posts` since this phase, so posts published before this change won't have per-post insights available.

**Confirmed working against a real connected account** (2026-09-14) -- deployed, invoked directly, and verified 93 real metric rows landed in `platform_metrics`, with a re-invoke confirming the upsert updates rows in place instead of duplicating. See `PLAN.md`'s Phase 9 section for the three real Graph API/schema bugs this surfaced and how they were fixed (wrong `metric_type` for 3 of 4 account metrics, `plays` renamed to `views`, and a `user_id` default that silently failed under the function's service-role context).

## Offers, tracked links, and the link-in-bio page

Everything above builds reach; this is the part that attaches something to click. Until it landed, neither generation function referenced `short_links` at all, so every auto-published post went out with no offer and nothing tracked, and the whole attribution stack (`redirect` -> `link_clicks` -> `revenue_events`) sat idle behind one manually-pasted bio link.

Apply the migrations first, then deploy -- the generation functions query `affiliate_offers` and will report an error per user (creating nothing) if the table isn't there yet:
```
supabase db push
supabase functions deploy generate-trend-posts
supabase functions deploy generate-reel-posts
supabase functions deploy publish-scheduled-posts
supabase functions deploy bio --no-verify-jwt
```

`bio` needs `--no-verify-jwt` for the same reason `redirect` does: real people open it from a bio link with no Supabase session.

**Offers** (Revenue page -> Offers) are what a generated post links to. A row is a program name, a destination URL, optional topic keywords, and a disclosure.

**Set the disclosure on any affiliate offer.** These posts publish unattended with no review step, so an affiliate link without one puts an undisclosed paid endorsement on a public account automatically -- which both the FTC's endorsement guides and Amazon's Associates Operating Agreement prohibit. The disclosure is appended with the link wherever the link appears, and the Offers list flags any active offer that doesn't have one. An offer pointing at something you own (a newsletter, your own landing page) isn't an endorsement and doesn't need one. The destination can be anything -- an affiliate tracking link, a product page, or your own newsletter signup -- so you don't have to wait on a network approving you to switch this on. With no active offer, posts still generate and publish, just untracked.

How a post gets its link:
- Claude picks the offer **inside the generation call it already makes** (the offer list goes into the prompt, and it returns an `offer_id`), so there's no second API call and no keyword matcher to maintain.
- The returned id is validated against the real offer list, and anything missing or hallucinated falls back to the highest-`priority` active offer. A post never ends up link-less, which is the failure mode this exists to fix.
- **One short link per post row, not per idea.** Fan-out already creates a row per platform, so each platform gets its own slug -- which means the click data finally answers which platform actually converts.

Where the link goes differs per platform, and this is not cosmetic:
- **Instagram / TikTok**: captions aren't clickable, so nothing is added to the caption. These platforms reach the offer through the bio page below.
- **Facebook**: clickable and free -- the URL is appended to the caption.
- **X**: clickable, but X bills **$0.20 per post containing a URL vs $0.015 without** (13x), so inline X links are **off by default**. Turn them on in Settings once there's conversion data to justify the cost.

**On X captions**: Instagram captions run 60-100 words, roughly double what X allows, so X gets its **own caption** rather than a truncated one. Both generation functions ask Claude for an `x_caption` written natively for X, sized to a budget that accounts for whatever will be appended to it (the tracked link counts as 23 characters, plus the disclosure if there is one). The budget is given to the model **in words**, not characters -- asking for a character count produced over-limit captions on every attempt, because models don't count characters reliably; a word target hit it first try. Every other platform keeps the long caption.

Truncation still exists as a safety net in `truncateForX`, for manually-created posts and for anything the budget doesn't cover. It matters that it's correct: X counts *weighted* characters, not string length -- `…` costs 2, as do emoji and most non-Latin characters, and any URL counts as exactly 23 no matter how long it is. A tweet one weighted character over the limit is rejected with `403 You are not permitted to perform this action`, which looks exactly like an app-permissions problem and cost this project a week of misdiagnosis (see PLAN.md Phase 10). The shared rules live in `supabase/functions/_shared/x-text.ts`.

**The bio page** turns Instagram's single bio link into one per post. Set a bio page address in Settings (blank turns the page off) and it serves at `/functions/v1/bio/<slug>`, listing recent published posts -- deduplicated across the platform fan-out -- each linking through `redirect`, so clicks log through the existing path with no new tracking code.

> **The HTML page does not work on the default `*.supabase.co` domain.** Supabase's gateway rewrites an Edge Function's `text/html` response to `text/plain` with a sandboxing CSP, so a browser shows the source rather than the page -- an anti-phishing measure on the shared domain (`redirect` is unaffected, since a 302 isn't HTML). Until there's a Supabase custom domain or a publicly-hosted front end, use `/functions/v1/bio/<slug>?format=json`, which returns the same content as data for any front end to render.

**The feedback loop**: both generation functions now include a digest of how recent posts actually performed (reach, clicks, clicks-as-a-percentage-of-reach, revenue -- from the new `post_performance` view over `posts` + `platform_metrics` + `link_clicks` + `revenue_events`) and are told to bias toward the top quartile. It's gated behind **20 published posts with real synced metrics** and omitted entirely below that, rather than sent thin -- under-powered data just teaches the model noise.

## Scripts

- `npm run dev` -- start the dev server
- `npm run build` -- type-check and build for production
- `npm run lint` -- run oxlint
- `npm run preview` -- preview the production build locally
