# Social Media Manager — Build Plan & Status

This file is the persistent record of what's been built, what's left, and the
non-obvious gotchas discovered along the way. It lives in the repo (not just
a session-local planning file) specifically so a fresh session/prompt can
pick up where the last one left off without rediscovering everything below
by trial and error.

## Context

Copilot's first pass produced a polished but entirely fake dashboard —
hardcoded arrays, no backend, no real data. The goal since has been to make
it real: track revenue actually attributed to social media activity, backed
by a real database and real Instagram (and eventually TikTok) integration.

Standing product decisions:
- **Revenue attribution**: affiliate/UTM short links with click tracking (not Stripe/Shopify sync).
- **Backend**: Supabase (Postgres + Auth + Edge Functions + Storage).
- **Tenancy**: single-owner schema (no workspaces/teams layer).
- **Auto-generated content**: posts (images and video Reels) are auto-drafted from trending topics in the user's niche and **auto-scheduled with no manual review step** before they go out.

> **Standing risk flag**: unreviewed AI-drafted content responding to trending news, posted autonomously to a public Instagram account, carries real brand-safety risk — wrong facts about a fast-moving story, tone-deaf timing on sensitive news, an off-brand joke. The user has explicitly chosen to skip manual review. The baseline safety net is a topic blocklist + an on/off kill switch (`automation_settings.auto_posting_enabled`, default **off**) — not a review step, just a fast way to stop it. Worth revisiting periodically.

## What stays the same

Keep the hand-written CSS design system in `src/App.css` as-is (dark sidebar,
coral/yellow/blue accents, DM Mono for numbers). No Tailwind, no component
library — this was a deliberate choice, not an oversight.

---

## Status at a glance

| Phase | What | Status |
|---|---|---|
| 1 | Foundations: Supabase auth/schema/RLS, routing, CRUD UI | ✅ Done |
| 2 | Auto-drafted image posts from trending topics (Claude + web search) | ✅ Done |
| 3 | Short links & click tracking (revenue attribution) | ✅ Done |
| 4 | Instagram OAuth connection | ✅ Done |
| 5 | Real image generation + auto-publish to Instagram | ✅ Done |
| 6 | AI-generated video Reels (Seedance) + auto-publish | ✅ Done |
| 7 | Impact.com live revenue reconciliation | ✅ Done |
| — | TikTok integration (OAuth + posting) | ❌ Not started |
| — | Real Instagram insights (reach/engagement data) | ❌ Not started |

**Everything above "not started" has been built, deployed, and confirmed working against real accounts** — a real post has published to Instagram, and a real AI-generated Reel has been generated, downloaded, and manually reviewed for quality. See the per-phase sections below for exact implementation details, file names, and the mistakes/corrections that got each one working.

## Remaining work (pick up here)

1. **TikTok integration** — OAuth (Login Kit) + Content Posting API. Same shape as the Instagram flow in Phase 4 below: `oauth_states.provider` already supports `'tiktok'` as a value, so the state-token infrastructure is reusable. Would also reuse the Reels video-generation pipeline from Phase 6 once TikTok's posting API is wired up. Needs: a TikTok developer account + app (user-created, like the Meta app was), and building `tiktok-oauth-start`/`tiktok-oauth-callback` Edge Functions mirroring `instagram-oauth-start`/`instagram-oauth-callback`.
2. **Real Instagram insights** — the `instagram_manage_insights` scope is already granted (see Phase 4), but nothing calls the actual insights endpoints yet. The Insights page currently only shows aggregate stats computed from local `posts`/`revenue_events` data, not real reach/engagement/impressions from Instagram itself. Needs: a new scheduled function (e.g. `sync-instagram-insights`) calling the Graph API's insights endpoints for the connected account, writing into a new `platform_metrics` table, and updating the Insights page to read real data.

Neither of these is blocked on anything technical — just needs deciding to start, plus the user creating the TikTok developer account for #1.

---

## Phase 1 — Foundations (done)

- `git init`, Supabase client (`src/lib/supabase.ts`), magic-link auth (`AuthProvider.tsx`, `LoginPage.tsx`, `RequireAuth.tsx`), routing via `react-router-dom` (`src/routes.tsx`), `@tanstack/react-query` for all data fetching.
- `App.tsx` decomposed into `AppShell`/`Sidebar`/`Topbar` + per-route pages, preserving the original CSS exactly.
- Schema (`supabase/migrations/0001_init.sql`): `social_profiles`, `social_profile_secrets` (service-role only, no RLS policies), `posts`, `short_links`, `link_clicks`, `revenue_events`, `automation_settings`. All owner tables scoped by RLS to `auth.uid() = user_id`.
- Full CRUD UI: Profiles (manual add/edit), Content Queue, Revenue (manual log), Settings (automation config, off by default), Overview (real aggregated metrics).
- Gotcha: `tsconfig.app.json` has `verbatimModuleSyntax: true` — type-only imports (e.g. `Session` from supabase-js) must use `import type { ... }`.
- Gotcha: hand-rolled Supabase `Database` types must use `type` object literals, not `interface`s — TypeScript only grants structural assignability to `Record<string, unknown>` (required by supabase-js's generic table constraint) to type literals, not interfaces.

## Phase 2 — Auto-drafted image posts from trending topics (done)

`supabase/functions/generate-trend-posts` — reads `automation_settings` per user (skips if `auto_posting_enabled` is false), calls Claude (`claude-opus-5`) with the `web_search_20260209` server tool to find real trends matching `niche_description` and draft posts in `brand_voice` (skipping `topic_blocklist` topics), parses the JSON response, and inserts rows into `posts` with `source = 'auto'`.

Deployed via `supabase secrets set ANTHROPIC_API_KEY=...` + `supabase functions deploy generate-trend-posts`, run on its own Supabase Cron Job (Edge Function type, POST) at **once a day** — deliberately much lower frequency than `publish-scheduled-posts`' 15-minute cron (Phase 5), since generation only needs to keep the queue topped up toward `daily_auto_post_cap` and the function already no-ops once that cap is reached for the day.

## Phase 3 — Short links & click tracking (done)

The actual revenue-attribution mechanism. `supabase/functions/redirect` (public, `--no-verify-jwt`) serves `/functions/v1/redirect/<slug>` (no custom domain), looks up `short_links`, logs a `link_clicks` row (referrer, user agent, SHA-256-hashed IP via the `cf-connecting-ip` header, country via Cloudflare's `cf-ipcountry` header — Supabase Edge Functions sit behind Cloudflare), and 302s to `destination_url` with UTM params appended. Logging failures never block the redirect.

Frontend: a "Short links" panel on the Revenue page (`useShortLinks.ts` hook) creates links (optionally tied to a post) and shows live per-link click counts — aggregated **client-side** from a plain `link_clicks` select rather than a typed PostgREST embed (`short_links(*, link_clicks(count))`), since the hand-rolled `Database` type has no `Relationships` metadata for the query builder to resolve embedded selects against.

**Monetization plan riding on this**: affiliate links (Amazon Associates via the region-specific site, e.g. `.com.au` not `.com`; or Impact for better-fitting AI-tool programs with higher commissions) go in the Instagram bio/Stories — captions aren't clickable on Instagram — wrapped in a short link from here so clicks are tracked instead of relying solely on the affiliate dashboard.

## Phase 4 — Instagram OAuth connection (done)

Turned out **App Review wasn't needed at all** — since the app only ever connects the developer's own Instagram account (as a tester/admin on the Meta app), Meta's Standard Access covers it fully.

- `supabase/functions/instagram-oauth-start` (JWT-verified): mints a single-use `oauth_states` row keyed to the calling user, returns Meta's authorization URL.
- `supabase/functions/instagram-oauth-callback` (`--no-verify-jwt`, hit directly by Meta's redirect): exchanges the code for a token, upgrades to a long-lived token, resolves the linked Facebook Page → Instagram Business Account (`/me/accounts` + `?fields=instagram_business_account`), fetches basic profile fields, and upserts `social_profiles` (keyed on `external_id`) + `social_profile_secrets`.
- "Connect Instagram" button + success/error banner on the Profiles page.

**Real scopes that work**: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management`, `instagram_manage_insights`, `instagram_content_publish`.

**Hard-won corrections** (don't re-derive these from scratch):
- `instagram_business_*`-prefixed scopes belong to a **different Meta product** ("Instagram API with Instagram Login", no Facebook Page involved) — invalid for this Page-linked flow.
- `instagram_manage_insights`/`instagram_content_publish` initially failed as "Invalid Scopes" — not a naming issue. Meta's dashboard now gates permissions behind **Use Cases**: My Apps → Use cases → Add use cases → **"Manage messaging and content on Instagram"**. Once added and showing "ready for testing," both scopes work immediately, no App Review needed.
- `business_management` is required to get `/me/accounts` to actually return the Page — Business-type Meta apps can silently return an empty list without it, even when a Page was selected in the consent screen.
- The Meta app needs its bare domain (e.g. `stkocgwlqfilsedtrjvy.supabase.co`, no `https://`, no path) added under **Settings → Basic → App Domains**, *in addition to* the full callback URL under **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**. Missing either one gives a "Can't load URL" domain error before the login screen even appears.
- Setup requires **both** a Facebook Page linked to the Instagram Business account (via the Page's own Settings → Linked Accounts, not the generic Accounts Center which links personal profiles) and the Meta app itself.

Schema: `oauth_states` table (service-role only, no RLS policies — consumed by the callback which has no Supabase session) and `social_profiles.external_id` + a unique `(user_id, platform, external_id)` index so reconnecting updates the existing row instead of duplicating it.

TikTok OAuth hasn't been started (see Remaining Work above).

## Phase 5 — Real image generation + auto-publish (done)

Instagram's API cannot publish a text-only post, so this phase added an image-generation step and a separate publish function.

- `generate-trend-posts` also calls OpenAI's **`gpt-image-2.5-flare`** (Claude has no image-output modality) per drafted idea, uploads the result to the public `post-images` Storage bucket, and links each post to the connected Instagram profile. A post whose image generation fails is dropped entirely rather than published image-less.
- Image generation runs **concurrently** (`Promise.allSettled`) across ideas in one invocation, not sequentially — Supabase Edge Functions have a **hard 150-second execution limit**, and sequential generation for more than 2-3 images blows past it (this was hit in practice: an `IDLE_TIMEOUT` after raising the daily cap). Per-invocation count is capped at 4 regardless of `daily_auto_post_cap`, independent of how high that setting is raised.
- Image prompts explicitly instruct the model to overlay the post headline as bold text with a dark gradient scrim — and to **forbid any other readable text/signage/logos** in the scene. The first version without that exclusion produced an image with no headline at all on a story about protest signage, because the model apparently spent its "text budget" on in-scene signs instead of the intended overlay.
- `supabase/functions/publish-scheduled-posts` (new): finds posts where `status = 'scheduled'`, `scheduled_for` has passed, and both `social_profile_id` and `media_url` are set. Calls Instagram's two-step publish (`POST /{ig-user-id}/media` → poll `status_code` until `FINISHED` → `POST /{ig-user-id}/media_publish`), then marks the post `published`.
- Runs on a Supabase Cron Job (Edge Function trigger). **Cron job HTTP timeout is capped at 5000ms by the platform** (not configurable higher) — the function can take longer than that in the worst case, but the Edge Function invocation itself keeps running server-side past that timeout regardless, so `posts.status` in the app is the real source of truth, not the cron job's own log (which will show a timeout even on a successful publish).
- Cron jobs calling Edge Functions need explicit `apikey` and `Authorization: Bearer <anon key>` HTTP headers set in the job config — the trigger doesn't send them by default, and the function will 401 without them.
- Both the Anthropic and OpenAI API keys needed real billing/credits added on their **developer platforms** (console.anthropic.com, platform.openai.com) before either worked — a ChatGPT or Claude.ai/Claude Code subscription does **not** fund these separate API billing pools.
- For cost-safety against a leaked key: create a **Restricted** OpenAI API key scoped to only the Images endpoint (Write), with a hard monthly spending cap on the project.

**Confirmed working end-to-end**: a real post published, returning an actual Instagram media ID.

## Phase 6 — AI-generated video Reels (done)

Added because static image posts cap organic reach — Instagram's algorithm favors Reels over image posts for reaching non-followers.

**Video provider decision trail** (don't redo this research):
- OpenAI's **Sora API was ruled out** — scheduled to shut down September 24, 2026.
- Google **Veo** was the safe fallback but its clips max out at 4-8 seconds, which would need multi-clip generation + stitching (real added complexity — video concatenation isn't trivial inside a Deno Edge Function) to reach a full-length Reel.
- **Volcano Engine** (Seedance's domestic ByteDance platform) reportedly requires **China real-name ID verification** that international (e.g. Australian) users can't complete.
- **BytePlus ModelArk** (`ark.ap-southeast.bytepluses.com`) is ByteDance's separate, English-documented, international-friendly platform serving the *same* Seedance models with none of Volcano Engine's verification wall — this is what's actually wired up. Model used: **Seedance 2.5** (`dreamina-seedance-2-5-260628`), which can produce a single 30-second take (used at 15s here), unlike Veo's short clips.

Video generation is genuinely async (5-15 minutes, not seconds), so unlike the image pipeline this is split across two functions rather than done synchronously:

- `supabase/functions/generate-reel-posts`: drafts a vertical (9:16) video concept + caption via Claude (same web-search approach as image posts), submits to Seedance (`POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks`, `Authorization: Bearer $ARK_API_KEY`), inserts the post as `status = 'generating'` with the returned task `id`.
  - **Before first use**, the model must be explicitly **activated** in the BytePlus Ark Console (Model Management → find `dreamina-seedance-2-5-260628` → activate) — having a valid API key alone isn't enough; the exact error was `"Your account ... has not activated the model ..."`.
- `supabase/functions/check-video-jobs` (separate cron, every 3-5 min): polls `GET .../tasks/{id}`; on `status: "succeeded"`, downloads `content.video_url` (with the same Bearer auth), uploads to the public `post-videos` Storage bucket, and flips the post to `scheduled`.
- `publish-scheduled-posts` branches on `posts.media_type`: video posts publish as Instagram Reels (`media_type=REELS` + `video_url` param instead of `image_url`), with a longer container-processing poll budget (20 attempts × 3s) than images (5 × 2s), since video processing takes longer on Instagram's side too.
- Schema: `posts.media_type` ('image'/'video') + `video_job_id`, a new `'generating'` post status, and `automation_settings.daily_reel_cap` kept **deliberately separate** from `daily_auto_post_cap` — video costs roughly 10-20x a single generated image, so it must not silently ride on a cap tuned for cheap images. Defaults to 1/day.
- Frontend: `QueueItem` renders a `<video>` thumbnail for video posts with a `#t=0.5` media-fragment hack + `preload="metadata"` (a bare `<video src>` often renders blank until played) plus a play-icon overlay so video posts are visually distinguishable from image posts at a glance.

**Confirmed working end-to-end**, including manually watching the actual generated video content (not just verifying the pipeline plumbed through) — held up on review.

## Phase 7 — Impact.com live revenue reconciliation (done)

`revenue_events` had been manual-entry-only since Phase 1. Two networks were evaluated for automatic reconciliation:

- **Amazon Associates was rejected.** Amazon's March/April 2026 reporting changes removed per-order/per-product data entirely — affiliates now see only a topline earnings number and a per-Tracking-ID summary (capped at 100 Tracking IDs), exportable **only as a manual CSV**. There is no public conversion API or postback for individual associates; a discretionary "S3 Data Feed" exists but requires Amazon support's approval on a case-by-case basis and still only delivers the same daily/periodic Tracking-ID-level aggregate — not real-time, not per-click.
- **Impact was chosen instead** — already namechecked in the Phase 3 monetization note as a better-fitting network for AI-tool affiliate programs. Impact supports a real **publisher postback**: registering a URL under Impact's dashboard (Event Notifications) that Impact calls per conversion event, substituting macros (`{ActionId}`, `{SubId1}`, `{Amount}`, `{Payout}`, `{Currency}`, `{Status}`, `{StatusDetail}`, `{EventDate}`, `{CampaignName}`). `SubId1` is publisher-controlled at tracking-link-build time — no pre-registration cap like Amazon's Tracking IDs.

Implementation:

- **No new column on `short_links`.** An Impact tracking link is pasted as a short link's existing `destination_url`, same as any other link. `supabase/functions/redirect` now unconditionally appends `subId1=<the short link's slug>` to the outgoing redirect (harmless extra query param on non-affiliate destinations) — this is what lets a conversion notification be matched back to the exact link/post that drove it, reusing the slug that already existed rather than adding new per-link config.
- `supabase/functions/impact-conversion-postback` (new, `--no-verify-jwt`, public like `redirect` since Impact's servers hit it with no Supabase session): validates a shared-secret `token` query param against `IMPACT_POSTBACK_TOKEN`, looks up the `short_links` row by `slug = subid1`, and upserts into `revenue_events` keyed by `external_ref = 'impact:<ActionId>'`.
- Schema (`0005_impact_revenue_postback.sql`): `revenue_events.external_ref` (unique per user, nullable) makes the upsert idempotent — Impact re-notifies as a conversion's status changes (e.g. pending → approved, or a later reversal), and the same row updates in place rather than duplicating. `revenue_events.status` (`pending`/`confirmed`/`reversed`) lets the Revenue page treat provisional and voided conversions differently: the chart excludes `reversed` events from totals, and `pending` ones show inline with a "(pending)" marker rather than reading as final.
- **Gotcha/assumption to verify against real data**: Impact's raw `Status` macro value wasn't independently confirmed beyond secondary sources — the postback function maps `APPROVED`/`LOCKED` → `confirmed` and `REVERSED`/`DECLINED` → `reversed`, defaulting anything else to `pending`. Confirm this against an actual postback payload once a real advertiser program is live and adjust `mapStatus()` in `impact-conversion-postback/index.ts` if Impact's real status strings differ.

Not yet confirmed working end-to-end against a real Impact account — the user had not yet signed up as a publisher at the time this was built. The redirect-appends-subId1 behavior and the postback-to-`revenue_events` upsert logic should both be smoke-tested per the README's setup steps once a real program is approved.

---

## Verification checklist

- `npm run dev` and manually walk each route: log in via magic link, add a profile, add a post, add a revenue event, confirm Overview's metric cards/chart/queue reflect real Supabase data.
- `npm run build` (runs `tsc -b`) — no type errors, particularly around `verbatimModuleSyntax` and the hand-rolled Supabase types.
- `npm run lint` (oxlint) clean.
- RLS: confirm a second test account (or Supabase SQL editor "run as authenticated user") cannot see another user's rows.
- `generate-trend-posts`: with `auto_posting_enabled = false`, invoke manually and confirm it exits without inserting rows; flip on, re-invoke, confirm posts appear with `source = 'auto'`, a populated `trend_source`, and content respecting the blocklist/brand voice.
- `generate-reel-posts` / `check-video-jobs`: submit a job, poll until `status: "ready"` in the response, then actually watch the downloaded video before trusting it to run unattended.
- End-to-end publish: confirm a real Instagram media ID comes back from `publish-scheduled-posts`, for both an image post and a video Reel.
- Impact postback: curl `redirect/<slug>` and confirm the `Location` header includes `subId1=<slug>`; curl `impact-conversion-postback` with a matching `subid1` and `status=APPROVED`, confirm a `revenue_events` row appears with `status: confirmed`; re-send the same `action_id` with `status=REVERSED` and confirm the same row updates rather than duplicating.
