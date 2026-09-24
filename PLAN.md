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
| 7 | Impact.com live revenue reconciliation | ⛔ Dead — publisher account not approved (2026-09-23). Code built, unusable |
| 8 | TikTok integration (OAuth + posting) | ✅ Confirmed via Sandbox; Production pending TikTok App Review |
| 9 | Real Instagram insights (reach/engagement data) | ✅ Done — confirmed against live data |
| 10 | X (Twitter) integration + multi-platform auto-post fan-out | ✅ **Fixed 2026-09-24** — the cause was never X, it was our own `truncateForX`. See "Root cause found 2026-09-24" |
| 11 | Facebook Page integration (OAuth + posting) | ✅ Confirmed live 2026-09-23 — connected since 09-17, 30 posts published (20 image, 10 video) |
| 12 | Monetization: connect the content pipeline to the revenue machinery | ✅ Steps 1-3 built, deployed and **verified against live data 2026-09-24**. One caveat: the bio page's HTML can't be served from supabase.co (JSON works). Steps 4-6 not started |

**Phases 1-9 have been built, deployed, and confirmed working against real accounts** — a real post has published to Instagram, a real AI-generated Reel has been generated, downloaded, and manually reviewed for quality, a real video has published to TikTok via the Content Posting API, and real reach/engagement data has been synced from the Instagram Graph API into `platform_metrics`. Phase 8's Production app is submitted for TikTok's App Review (needed for public, not just private-account, posting) — see its section below for the Developer Portal setup corrections and API gotchas this took to get working, several of which aren't documented anywhere obvious on TikTok's side. See the per-phase sections below for exact implementation details, file names, and the mistakes/corrections that got each one working.

## Remaining work (pick up here)

0. **Monetization** (Phase 12) — **still the current priority.** Steps 1-3 are built and **deployed** (2026-09-24): migrations `0013`, `0014`, `0016`, `supabase/functions/_shared/monetization.ts`, offer-matching + per-row short links in both generation functions, the public `bio` function, and the `post_performance` feedback digest. See the Phase 12 section for exactly what each does. **It is deployed but not yet earning**, because the pipeline only attaches links when there's something to link to. Next actions, in order:
   1. **Add at least one `affiliate_offers` row** (Revenue page → Offers). **With zero active offers this whole phase is a no-op by design** — posts still generate and publish, just untracked, exactly as before. There is still no approved affiliate network (see Phase 7), so the first row should point at something you own: a newsletter signup or a landing page. The click-tracking half works identically regardless. **Nothing else in this phase does anything until this row exists.**
   2. Set a bio page address in Settings and put `/functions/v1/bio/<slug>` in the Instagram bio. The endpoint is live and returns 404 for every slug until one is set (verified 2026-09-24), so the page is off until you deliberately turn it on.
   3. Run `generate-trend-posts` once manually and work the "Verification additions for this phase" checklist at the end of the Phase 12 section — **none of it has been done**, since every item needs a real generation run (which costs real Claude + OpenAI spend and produces posts that will auto-publish).
   **Deploy-order trap, for whenever this is redeployed:** migrations before functions, never the reverse. `fetchActiveOffers` throws if `affiliate_offers` doesn't exist, and that error is caught per-user, so a function deployed early doesn't fail loudly — it quietly creates nothing.
   **Resist adding a fifth platform** — TikTok is `SELF_ONLY` (zero public reach until audit), Facebook is unverified, and X only publishes video reliably, so Instagram plus X-for-Reels is the whole earning surface today. Another integration adds zero dollars; fixing X's image path adds a live clickable-caption channel.

0b. ~~**Deploy `impact-conversion-postback`**~~ — **retracted 2026-09-23. Do not deploy it.** It is correctly absent from the 14 ACTIVE functions, because **the Impact publisher account was not approved**, so there is no program, no tracking link, and nothing that will ever call this endpoint. Deploying it would expose a public endpoint serving no purpose. See Phase 7 below for what this invalidates and what survives.

1. ~~**Facebook integration** (Phase 11)~~ — **done, confirmed 2026-09-23**: connected since 09-17 with 30 posts published (20 image, 10 video), all with real Page post ids. Only a visual check of the Page itself remains. Original note follows for reference: **Facebook integration** (Phase 11) — built (migration, OAuth pair, publish path, fan-out) but **not yet run against a real account**: needs the Meta app's redirect URI + `FACEBOOK_REDIRECT_URI` secret set, both functions deployed, and a real "Connect Facebook" click followed by a real scheduled post to confirm the Page-feed publish path actually works. See Phase 11 section and README's "Connecting Facebook".
2. ~~**X integration** (Phase 10)~~ — **DONE, fixed and verified 2026-09-24.** Every theory below (package enrollment, credits, an account restriction, an X platform-side bug) was **wrong**. The cause was a one-character bug in this repo: `truncateForX` produced exactly 280 *JavaScript* characters ending in `…`, and X weighs `…` as 2, so every truncated tweet was 281 weighted characters — one over — which X rejects with a generic `403 You are not permitted to perform this action` that reads exactly like a permissions problem. Two real auto-generated image posts published within minutes of the fix. **Do not open a devcommunity thread. Do not touch the Developer Portal.** Full writeup in "Root cause found 2026-09-24" in the Phase 10 section.
3. **TikTok integration** (Phase 8) — fully confirmed end-to-end via Sandbox (real publish, real `platformMediaId` returned). Waiting on TikTok's App Review response for the Production app before public (non-`SELF_ONLY`) posting is possible -- check review status and, once approved, set `TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE` and switch `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` from the Sandbox credentials to Production's.
4. ~~**Impact.com reconciliation** (Phase 7)~~ — **dead as of 2026-09-23: the Impact publisher account was not approved.** Nothing here is confirmable, because there will be no postback. Don't spend further time on `mapStatus()` or the postback function. A replacement affiliate network is now a **prerequisite for Phase 12 Step 1** — see that step's revised "Where the offers come from."

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
- **Headline text getting cut off at the start and end** (discovered from a real published post): with no margin/wrap guidance, the model tends to set the headline as one long line sized to span the full image width, clipping the first/last few characters right at the canvas edge — this happens in the generated image file itself, it's not Instagram cropping anything after the fact. Fixed by adding explicit instructions: keep at least an 8% margin on the left/right, wrap across two or three shorter lines instead of one long line, and double-check no letters are cut off before finishing.
- **The 8%-margin instruction wasn't reliable enough** (discovered 2026-09-15 from real published posts still showing text touching/crossing the canvas edge, visible in the profile grid thumbnails) — as a standalone sentence following the "MANDATORY" headline instruction, the model still treated large-and-bold as the priority and margin as negotiable. Fixed by folding the margin/wrap/font-size constraint directly into the MANDATORY sentence itself (making it one inseparable hard constraint rather than a follow-up preference), bumping the margin to 12%, explicitly telling it to shrink the font and wrap across up to four lines rather than ever spanning edge-to-edge, and rewording the final self-check to "measure the widest line against the canvas width" instead of the vaguer "no letters cut off." Verified by generating a real test image via a temporary debug function (not the production pipeline — no `posts` row, no Storage upload, no auto-publish risk) with a deliberately long stress-test headline; the result wrapped cleanly across two lines with visible margin on both sides. The equivalent instruction in `generate-reel-posts`' Reels safe-zone guidance (10% margin / 80% width) was reinforced the same way (12% / 76%) for consistency, though not independently re-verified against a real Seedance render. This is still prompt-based compliance, not a hard guarantee — worth revisiting if cut-off text recurs.
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
- `supabase/functions/check-video-jobs` (separate cron, every 3-5 min): polls `GET .../tasks/{id}`; on `status: "succeeded"`, downloads `content.video_url` (with the same Bearer auth), uploads to the public `post-videos` Storage bucket, and flips the post to `scheduled`. On a Seedance-reported failure, marks the post `status: 'failed'` with `failure_reason` set (see below) rather than the auto-caps' generation count ever including it.
- `publish-scheduled-posts` branches on `posts.media_type`: video posts publish as Instagram Reels (`media_type=REELS` + `video_url` param instead of `image_url`), with a longer container-processing poll budget (20 attempts × 3s) than images (5 × 2s), since video processing takes longer on Instagram's side too.
- Schema: `posts.media_type` ('image'/'video') + `video_job_id`, a new `'generating'` post status, and `automation_settings.daily_reel_cap` kept **deliberately separate** from `daily_auto_post_cap` — video costs roughly 10-20x a single generated image, so it must not silently ride on a cap tuned for cheap images. Defaults to 1/day.
- Frontend: `QueueItem` renders a `<video>` thumbnail for video posts with a `#t=0.5` media-fragment hack + `preload="metadata"` (a bare `<video src>` often renders blank until played) plus a play-icon overlay so video posts are visually distinguishable from image posts at a glance.

**Confirmed working end-to-end**, including manually watching the actual generated video content (not just verifying the pipeline plumbed through) — held up on review.

**Seedance content-moderation rejections (discovered later, in production use)**: Seedance can reject a finished generation outright with e.g. `OutputVideoSensitiveContentDetected` — no partial output, no retry within the same job. First hit on a real trending topic ("Meta's smart glasses catching covert filmers") whose literal visual depiction (hidden-camera/surveillance imagery) tripped the classifier, even though the underlying news topic itself was completely unremarkable.
- `check-video-jobs` originally just **deleted** the post outright on any Seedance-reported failure, with zero trace of why — diagnosing an actual occurrence required temporarily adding a debug route to query ARK's task-status endpoint directly by job id (the post row was already gone, but ARK's own task record isn't tied to our database). Fixed: it now sets `status: 'failed'` + `failure_reason` (migration `0008_post_failed_status.sql`) instead of deleting, and the Content Queue UI renders failed posts with the rejection reason visible.
- Guardrail added to `generate-reel-posts`'s Claude prompt: explicit instructions to avoid visuals commonly flagged by video-generation moderation (covert filming/surveillance, violence/weapons/gore, sexual content, self-harm, drugs, hate symbols, identifiable private individuals in compromising situations) and to prefer visual metaphors/on-screen text over literally staging a sensitive scenario. This reduces the *chance* of a rejection since the news topic itself is often fine even when a literal depiction wouldn't be — it doesn't eliminate rejections entirely, since Seedance's classifier is opaque and unpredictable from the outside.
- **A second, differently-shaped rejection** (2026-09-18, "The request failed because the output video may contain sensitive information") hit a prompt with no obviously sensitive subject matter — an AI story ("The AI That Does 26% of Its Own Homework") illustrated as one glowing orb literally assembling a second, smaller orb beneath it, i.e. an AI autonomously building/replicating another AI. Confirmed this wasn't a BytePlus billing/balance problem before treating it as content-related: the raw error text comes straight through from ARK's own task-status response (`check-video-jobs` just passes through `statusJson.error.message`, doesn't synthesize it), and other video jobs submitted and completed successfully both before and after this one, which a genuine account-balance exhaustion wouldn't allow. Recursive self-improvement imagery (one AI literally constructing another) is the most likely trigger. Added a second, narrower guardrail to the same prompt-steering block: when a story is about one AI training/building/improving another, avoid depicting that literally as autonomous self-replication — prefer a metaphor like an evolving shape, a growing network graph, or an ascending chart instead. Same caveat as above: prompt-based mitigation, not a guarantee, and not independently re-verified against a real Seedance render yet.
- **A third rejection category, audio rather than video** (2026-09-19/20, "The request failed because the output audio may be related to copyright restrictions", on the idea "The King Called a Meeting"): notably, `generate-reel-posts` always submits with `generate_audio: true` and the `video_prompt` never specifies any music or audio direction at all — this is Seedance's own auto-composed soundtrack getting flagged, not anything requested. Since there's no audio description to steer away from, `check-video-jobs` instead handles this class with an **automatic one-shot resubmit**: `isAudioCopyrightFailure()` matches on `/audio/i` + `/copyright/i` in the failure reason, and `resubmitWithoutAudio()` resubmits the exact same `video_prompt` with `generate_audio: false`, updating the affected posts' `video_job_id` in place (still `status: 'generating'`) rather than marking them `failed`. This can't loop — a `generate_audio: false` resubmit has no audio to be flagged for copyright, so the same branch can't fire again on its own retry; any other failure on the retry (including a genuinely-different one) falls through to the normal `failed` path. Chosen over the alternatives (disable audio globally, or just add prompt language asking for generic/unbranded audio) because it keeps audio on the common-case video without giving up reliability on the failure case. **Not yet proven against a real occurrence** — deployed 2026-09-20, waiting for the next natural audio-copyright rejection to confirm the resubmit path actually recovers the idea (deliberately not force-tested, since forcing it means paying for a real Seedance generation just to prove the retry fires).

**On-screen text getting cut off in the real Instagram app (discovered from a real published Reel)**: with no sizing guidance, the model tends to render any on-screen headline/caption text edge-to-edge across the full frame width. Instagram Reels overlays its own UI (captions bar, profile info, like/comment icons) across the outer margin of the frame, so text rendered all the way to the edges reads as visibly cut off in the app even though the raw video file contains it in full — this is an Instagram-viewport problem, not a generation defect. Fixed by adding an explicit safe-zone instruction to the `video_prompt` guidance: center any on-screen text, size it to fit within the middle 80% of the frame width, wrap across 2-3 short lines rather than one long line, and keep at least a 10% margin clear on every edge.

**`posts.video_prompt`** (migration `0009_post_video_prompt.sql`): the exact `video_prompt` text sent to Seedance is now persisted on the post row. Previously it was used once at submission and discarded — neither our database nor BytePlus's own task-status API retains it, so there was no way to answer "what prompt produced this video" after the fact (found out the hard way when asked to explain a specific already-published Reel).

## Phase 7 — Impact.com live revenue reconciliation (done)

`revenue_events` had been manual-entry-only since Phase 1. Two networks were evaluated for automatic reconciliation:

- **Amazon Associates was rejected.** Amazon's March/April 2026 reporting changes removed per-order/per-product data entirely — affiliates now see only a topline earnings number and a per-Tracking-ID summary (capped at 100 Tracking IDs), exportable **only as a manual CSV**. There is no public conversion API or postback for individual associates; a discretionary "S3 Data Feed" exists but requires Amazon support's approval on a case-by-case basis and still only delivers the same daily/periodic Tracking-ID-level aggregate — not real-time, not per-click.
- **Impact was chosen instead** — already namechecked in the Phase 3 monetization note as a better-fitting network for AI-tool affiliate programs. Impact supports a real **publisher postback**: registering a URL under Impact's dashboard (Event Notifications) that Impact calls per conversion event, substituting macros (`{ActionId}`, `{SubId1}`, `{Amount}`, `{Payout}`, `{Currency}`, `{Status}`, `{StatusDetail}`, `{EventDate}`, `{CampaignName}`). `SubId1` is publisher-controlled at tracking-link-build time — no pre-registration cap like Amazon's Tracking IDs.

Implementation:

- **No new column on `short_links`.** An Impact tracking link is pasted as a short link's existing `destination_url`, same as any other link. `supabase/functions/redirect` now unconditionally appends `subId1=<the short link's slug>` to the outgoing redirect (harmless extra query param on non-affiliate destinations) — this is what lets a conversion notification be matched back to the exact link/post that drove it, reusing the slug that already existed rather than adding new per-link config.
- `supabase/functions/impact-conversion-postback` (new, `--no-verify-jwt`, public like `redirect` since Impact's servers hit it with no Supabase session): validates a shared-secret `token` query param against `IMPACT_POSTBACK_TOKEN`, looks up the `short_links` row by `slug = subid1`, and upserts into `revenue_events` keyed by `external_ref = 'impact:<ActionId>'`.
- Schema (`0005_impact_revenue_postback.sql`): `revenue_events.external_ref` (unique per user, nullable) makes the upsert idempotent — Impact re-notifies as a conversion's status changes (e.g. pending → approved, or a later reversal), and the same row updates in place rather than duplicating. `revenue_events.status` (`pending`/`confirmed`/`reversed`) lets the Revenue page treat provisional and voided conversions differently: the chart excludes `reversed` events from totals, and `pending` ones show inline with a "(pending)" marker rather than reading as final.
- **Gotcha/assumption to verify against real data**: Impact's raw `Status` macro value wasn't independently confirmed beyond secondary sources — the postback function maps `APPROVED`/`LOCKED` → `confirmed` and `REVERSED`/`DECLINED` → `reversed`, defaulting anything else to `pending`. Confirm this against an actual postback payload once a real advertiser program is live and adjust `mapStatus()` in `impact-conversion-postback/index.ts` if Impact's real status strings differ.

**Dead end, 2026-09-23: the Impact publisher application was rejected.** Impact gatekeeps publisher signups, and this account didn't get through. That removes the entire automatic revenue-reconciliation path this phase was built for. Combined with Phase 7's earlier finding that **Amazon Associates offers no per-order API at all**, the project currently has *no* automated revenue data source — `revenue_events` can only be populated by hand.

**What dies**: `impact-conversion-postback` (do not deploy it — see Remaining Work 0b), the `mapStatus()` question, and the Impact setup steps in the README.

**What survives, and is unaffected**: the whole click-attribution stack is network-agnostic. `short_links`, `redirect`, `link_clicks`, per-link click counts, and the UTM appending all work against *any* destination URL. Only the conversion-notification half was Impact-specific. The `subId1` param `redirect` appends unconditionally is harmless on non-Impact destinations (that was a deliberate design note from this phase) and can stay, or be renamed to whatever a replacement network uses.

**Replacement networks worth trying**, roughly in order of fit for an AI-tools niche and ease of approval:
- **Direct programs run by the AI tools themselves** — most run on Rewardful, FirstPromoter, or Tolt, which typically offer per-conversion webhooks that map onto `revenue_events` the same way Impact's postback would have. Usually near-automatic approval, and commissions are often better than a network's.
- **PartnerStack** — strong B2B/SaaS coverage, which is where AI-tool programs concentrate.
- **ShareASale/Awin, CJ, Rakuten** — broader, more consumer-shaped, generally less strict than Impact on publisher approval.

Whichever is chosen, the postback function is ~70 lines and mostly reusable: swap the macro names and the status mapping, keep the slug lookup and the `external_ref` idempotent upsert.

Original build notes follow (kept for reference — the implementation itself is sound, it just has no account behind it). Not confirmed working end-to-end against a real Impact account. The redirect-appends-subId1 behavior and the postback-to-`revenue_events` upsert logic should both be smoke-tested per the README's setup steps once a real program is approved.

## Phase 8 — TikTok integration (confirmed working end-to-end via Sandbox; Production app pending TikTok's App Review)

Same shape as Phase 4's Instagram flow, reusing `oauth_states.provider = 'tiktok'` (already supported since migration 0002) and the Reels pipeline from Phase 6 for video content.

- `supabase/functions/tiktok-oauth-start` (JWT-verified): mints an `oauth_states` row, returns TikTok's Login Kit authorization URL (`https://www.tiktok.com/v2/auth/authorize/`, `client_key` not `client_id` — different param name than Meta's flow).
- `supabase/functions/tiktok-oauth-callback` (`--no-verify-jwt`): exchanges the code at `https://open.tiktokapis.com/v2/oauth/token/` (form-encoded body, not JSON), fetches profile via `/v2/user/info/`, upserts `social_profiles` (`platform = 'tiktok'`) + `social_profile_secrets` (both `access_token` and `refresh_token`).
- "Connect TikTok" button next to "Connect Instagram" on the Profiles page, with its own `tt_connected`/`tt_error` query params (separate from Instagram's `ig_*` ones so both flows' banners can coexist).
- `publish-scheduled-posts` now branches per `social_profiles.platform`: Instagram posts go through the existing two-step media/publish flow; TikTok posts go through the Content Posting API's `/v2/post/publish/video/init/` (source `PULL_FROM_URL` against the post's `media_url`) + `/v2/post/publish/status/fetch/` poll. TikTok-only supports video, so an image post assigned to a TikTok profile fails loudly rather than silently no-oping.
- Token refresh handled inline in `publish-scheduled-posts` (`refreshTiktokTokenIfNeeded`) rather than a separate cron: TikTok access tokens last only ~24h (vs. Instagram's ~60 days), refreshed via `grant_type=refresh_token` whenever fewer than 5 minutes remain, using the `refresh_token` (~365 day lifetime) already stored in `social_profile_secrets`.

**Scopes**: `user.info.basic`, `user.info.stats`, `video.publish`. Deliberately not requesting `user.info.profile` (needed for real `username`) since it's its own review step beyond default Login Kit access — the connected profile's `handle` falls back to `@<display_name>` instead.

**Known gap, not a bug to "fix" — a TikTok platform constraint**: the Content Posting API gates *public* posting behind its own app audit, separate from basic Login Kit approval. Until that audit is granted, TikTok requires unaudited apps to post `privacy_level: SELF_ONLY` (visible only to the connected account) — hardcoded as the default here, overridable via the `TIKTOK_PRIVACY_LEVEL` secret once audited. This directly undercuts the "fully unattended, goes public with no review" design goal for TikTok specifically until that audit clears; Instagram has no equivalent gate (Phase 4's Standard Access finding).

**`PULL_FROM_URL` requires the video's domain to be verified as a "URL Prefix"** for the TikTok app in the Developer Portal (like Meta's App Domains step) — confirmed required in practice (the first real publish attempt failed with exactly this until the domain was verified, see below).

**Every direct-post request must first call TikTok's Creator Info Query endpoint** (`/v2/post/publish/creator_info/query/`) and use only the `privacy_level` (and duet/comment/stitch disable flags) it returns as allowed for that specific creator — hardcoding `privacy_level: SELF_ONLY` blindly still gets rejected. `publishToTiktok` in `publish-scheduled-posts` now queries this first (`queryTiktokCreatorInfo`) before every publish. This was not documented anywhere obvious; discovered by making the function surface TikTok's raw error body during debugging, which revealed the real error code (`unaudited_client_can_only_post_to_private_accounts`) behind an otherwise generic-looking rejection.

**Unaudited apps additionally require the connected TikTok account itself to be set to a Private account** (TikTok app → Settings and privacy → Privacy → Private account) — this is separate from, and in addition to, sending `privacy_level: SELF_ONLY` on the post itself. A public account gets `unaudited_client_can_only_post_to_private_accounts` regardless of what `privacy_level` the request sends, until the Content Posting API audit is granted.

### Hard-won TikTok Developer Portal setup corrections (don't re-derive these)

Getting from "created a TikTok app" to a successful OAuth connect took several rounds of debugging a genuinely unhelpful TikTok error page (`"We couldn't log in with TikTok... correct the following: client_key"` — the same wording appears whether the actual problem is the client_key, redirect_uri, or scopes; you have to isolate which by trial, TikTok doesn't say):

- **Production apps in "Draft" status cannot complete any OAuth login at all, even for the developer's own account.** TikTok requires using the separate **Sandbox** mode (its own tab next to Production on the app page) for pre-review testing — click "Create Sandbox" to get a sandbox version of the app, with its **own distinct Client Key/Secret** (different from Production's). Point `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` at the Sandbox credentials while testing, not Production's.
- **Terms of Service URL and Privacy Policy URL are required fields to save the Sandbox app config, not just for App Review.** Along with App icon, Category, Description, and at least one Platform checkbox (`Web`, for this project's browser-redirect flow) — the form won't save without all of them. These pages don't need to be sophisticated; a simple public GitHub Pages site works (see `signal-social-media-legal` repo).
- **Products (Login Kit, Content Posting API) must be explicitly added to the app before their scopes become addable at all.** `user.info.basic` and `video.publish` don't show up under "+ Add scopes" until Login Kit and Content Posting API respectively are added under the app's Products section — this is true independently for Production and Sandbox, they don't share config.
- **Every scope actually used must be explicitly added and saved ("Apply changes")** — `user.info.stats` in particular is easy to forget since it's not bundled with `user.info.basic`, and a silently-missing scope produces the exact same generic error as everything else that can go wrong here.
- **The Sandbox's Target Users list (Sandbox settings → Target users) must include the TikTok account being used to test**, added by username. Unlike some platforms, this list does **not** show or require per-scope grants next to each user — the scopes that matter are the ones added to the app as a whole (see above), not a separate per-user permission set. It's easy to wrongly suspect a per-user scope problem when the real issue is an unsaved "Apply changes."
- **Any unsaved edit on the Sandbox config page (scopes, target users, basic info) doesn't take effect until "Apply changes" is clicked** — the button stays visibly highlighted while changes are pending, which is the one visual cue that config edits haven't gone live yet.
- The redirect URI must be registered under the Sandbox app's own Login Kit settings (separately from Production's) and match `TIKTOK_REDIRECT_URI` byte-for-byte — trailing slash or scheme mismatches fail silently into the same generic `redirect_uri` error.
- **URL Prefix domain verification (required for `PULL_FROM_URL`, and separately for the Terms of Service / Privacy Policy / redirect URIs on the Production app) works by "signature file"**: TikTok gives a filename + content and checks for it at a path that treats the *entire registered URL as a directory prefix*, appending a trailing slash even if the URL already ends in something like `.html` or is a live API route. Concretely: registering `https://.../terms.html` as a property means TikTok checks `https://.../terms.html/<signature-file>`, not a file placed next to `terms.html`. For a static site (GitHub Pages, in this project's case) this means restructuring `terms.html` from a file into a real directory containing `index.html` (the actual page) plus the signature file as siblings — a plain file and a directory of the same name can't coexist. For a live endpoint that isn't a static host (the `tiktok-oauth-callback` Edge Function, needed to verify the redirect URI itself), the function has to serve the signature file itself as an extra route matched by the last URL path segment — see `TIKTOK_VERIFICATION_FILES` in that function.
- Re-registering the *same* URL for Production after it was already verified for Sandbox requires a **new** signature file each time — verification is scoped per app version (Sandbox vs. Production), not shared.
- A "Request error: Something went wrong. Please try again" on Verify was transient in practice, unrelated to the file/config being correct — worth a plain retry before assuming something is actually broken.

**Confirmed working end-to-end**: a real video published through TikTok's Content Posting API via `publish-scheduled-posts`, returning a real `platformMediaId` — required, in order: the Sandbox OAuth connect, the account set to Private, the video's Storage domain verified as a URL Prefix, and the Creator Info Query fix above. The **TikTok account itself must currently be Private** for any publish to succeed at all, since the app isn't yet audited for public posting.

**Production app submitted for TikTok's App Review** (Content Posting API audit, to eventually allow public posting) — pending TikTok's response as of this writing. Until approved, all publishing (Sandbox or Production) is restricted to `SELF_ONLY`/private-account visibility per the constraint above.

## Phase 9 — Real Instagram insights (done, confirmed against live data)

The `instagram_manage_insights` scope was already granted back in Phase 4; this phase actually calls it.

- `supabase/functions/sync-instagram-insights` (cron, hourly): for every connected Instagram profile, fetches account-level insights (`reach`, `profile_views`, `accounts_engaged`, `total_interactions`) and, for every already-published post with a stored `platform_media_id`, per-media insights (`reach`, `likes`, `comments`, `saved`, `shares`, plus `views`/`total_interactions` for Reels).
- `publish-scheduled-posts` now saves the platform's returned id (Instagram media id / TikTok publish id) onto `posts.platform_media_id` on successful publish (migration 0006) — previously this was fetched and immediately discarded, since nothing needed it before this phase.
- Schema (`0006_platform_media_id_and_insights.sql`): new `platform_metrics` table, one row per `(social_profile_id or post_id, metric_name, metric_date)`. A generated `metric_scope` column (`coalesce(post_id::text, 'account')`) exists solely so upserts conflict-detect correctly — a plain unique index on a nullable `post_id` wouldn't work, since Postgres treats every `NULL` as distinct from every other `NULL`, so repeated account-level syncs on the same day would never match as "the same row" and would just accumulate duplicates.
- RLS: select-only policy for the owner, no insert/update/delete policy — same locked-to-service_role pattern as `link_clicks`, since only the sync function ever writes here.
- Frontend: `usePlatformMetrics` hook (read-only) + `InsightsPage` now renders real account-level metric cards and a per-post performance list when data exists, falling back to the old aggregate-only messaging when it doesn't (e.g. before the first sync has run, or before any post is 24h old).

**Three real bugs found and fixed during live verification** (2026-09-14, invoked directly against the real connected Instagram account):

1. **Account-level metric_type was wrong for 3 of the 4 metrics.** Only `reach` actually supports `metric_type=time_series`; `profile_views`, `accounts_engaged`, and `total_interactions` all 400 with `"(#100) The following metric (X) is incompatible with the metric type (time_series)"` and require `metric_type=total_value` instead — confirmed by hitting the real Graph API and reading the actual error, one metric at a time. Fixed by splitting `fetchAccountMetrics` into `fetchTimeSeriesAccountMetrics` (just `reach`) and `fetchTotalValueAccountMetrics` (the other three, response shaped as `{ total_value: { value } }` per metric rather than a per-day `values` array — stored against today's date like the media metrics are).
2. **`plays` isn't a valid per-media metric name** in this Graph API version (`v26.0`) — the real error was `"metric[5] must be one of the following values: impressions, reach, replies, saved, likes, comments, shares, total_interactions, follows, profile_visits, profile_activity, navigation, ig_reels_video_view_total_time, ig_reels_avg_watch_time, views, ..."`. The correct name for video view count is now `views`. Fixed in `VIDEO_MEDIA_METRICS`.
3. **`platform_metrics.user_id` defaults to `auth.uid()`, which is `NULL` under a service-role request** (no user JWT in context) — every insert was violating the `NOT NULL` constraint, which the original error handling swallowed into a useless `"unknown error"` because `PostgrestError` doesn't pass `instanceof Error`. Fixed by selecting `user_id` alongside each `social_profiles` row and threading it explicitly through every metric-producing function into the `Metric` type, rather than relying on the column default; also added an `errorMessage()` helper that reads `.message` off non-Error-shaped thrown values so this class of bug surfaces its real reason instead of `"unknown error"` next time.

**Confirmed working end-to-end**: deployed, invoked directly (not just via cron) against the real connected Instagram account — 93 real metric rows written (account-level `reach`/`profile_views`/`accounts_engaged`/`total_interactions`, per-post `reach`/`likes`/`comments`/`saved`/`shares` across 16 posts, plus `views`/`total_interactions` on Reels), values sanity-checked directly in the DB. Re-invoked a second time and confirmed the row count stayed at 93 — the upsert updates in place rather than duplicating, as designed. The 24h-too-young media-insights 400 never actually triggered against any of the tested posts (several were under 24h old and still returned full metrics), so that assumption from the original build is unconfirmed either way — the code's substring-matching skip for it is untested but harmless if never hit. Scheduled on its own hourly `sync-instagram-insights` pg_cron job, matching the other functions' cron pattern.

## Phase 10 — X (Twitter) integration + multi-platform auto-post fan-out (OAuth + image publish confirmed live; video publish and fan-out still to verify)

Adds X as a third connectable/publishable platform, same auto-posting model as Instagram/TikTok (no manual review step). Also fixes a gap discovered while building this: `generate-trend-posts`/`generate-reel-posts` had only ever targeted the connected **Instagram** profile — TikTok, despite being fully wired for OAuth+publishing since Phase 8, never actually received an auto-generated post; it could only be posted to by manually reassigning a post's `social_profile_id`. Both generation functions now fan each idea out to one post row per connected, platform-eligible profile.

**X's API, Sept 2026**: the free tier is gone — posting is pay-per-use ($0.015/plain post, $0.20/post with a URL), billed to a Developer Portal payment method. OAuth is Authorization Code + PKCE even for a confidential (secret-holding) client, unlike Instagram/TikTok's flows.

- Schema (`0010_x_oauth.sql`): `'x'` added to both `social_profiles.platform` and `oauth_states.provider` check constraints; `oauth_states.code_verifier` (nullable) added to carry the PKCE verifier from `x-oauth-start` to `x-oauth-callback` — the only one of the three OAuth flows that needs it.
- `supabase/functions/x-oauth-start` (JWT-verified): generates a PKCE `code_verifier`/`code_challenge` (S256), mints the `oauth_states` row, returns `x.com/i/oauth2/authorize`'s URL. Scopes: `tweet.read tweet.write users.read offline.access media.write`.
- `supabase/functions/x-oauth-callback` (`--no-verify-jwt`): exchanges the code at `POST /2/oauth2/token` (HTTP Basic auth with `client_id:client_secret`, `code_verifier` in the body), fetches `/2/users/me` for profile fields, upserts `social_profiles`(`platform: 'x'`)/`social_profile_secrets`.
- `publish-scheduled-posts`: `refreshXTokenIfNeeded` (Basic-auth'd `grant_type=refresh_token`, persists the **rotated** `refresh_token` X's docs describe on every refresh — unverified live) and `publishToX` — chunked media upload (`/2/media/upload/initialize` → `/{id}/append` (multipart, ≤4MB chunks) → `/{id}/finalize`, polling `?command=STATUS` for video) then `POST /2/tweets` with `{ text, media: { media_ids } }`. Caption truncated to 280 chars.
- Fan-out (`generate-trend-posts`, `generate-reel-posts`): each function now looks up **all** connected profiles on eligible platforms (images: `instagram`/`x` — TikTok has no image posting; video: `instagram`/`tiktok`/`x`) instead of a single Instagram lookup, and inserts one `posts` row per eligible profile per idea, all sharing the same generated `media_url`/`video_job_id`. The daily cap (`daily_auto_post_cap`/`daily_reel_cap`) now counts **distinct ideas** (by today's distinct `title` values) rather than post rows, so it still means "N pieces of content" rather than "N platform-posts" now that one idea produces multiple rows.
- `check-video-jobs` was updated for the same reason: since a video job can now be shared by multiple post rows (one video, N platform-targeted rows), it groups pending posts by `video_job_id` and only polls Seedance / downloads+re-uploads the finished video **once per job**, then updates every row sharing that job — not once per row, which would have redundantly re-downloaded and re-uploaded the same video N times.
- Frontend: "Connect X" button + `x_connected`/`x_error` banner on Profiles (mirrors TikTok's); `'x'` added to the manual-add platform picker. Content Queue now shows each post's target platform (`QueueItem` receives its `SocialProfileRow` via `QueueList`) — needed because fan-out means the same idea now legitimately appears as multiple rows, which would otherwise look like duplicates.

**Hard-won X Developer Portal correction (don't re-derive this)**: a Project can be scoped to **"MCP access only"** — a limited tier for X's MCP server, separate from full v2 REST API access. Credentials from an MCP-only Project pass OAuth 2.0 token exchange fine (the `/2/oauth2/token` call succeeds, since that's just client-credential validation), but **every actual v2 resource call fails** with a misleading error: `"When authenticating requests to the X API v2 endpoints, you must use keys and tokens from a developer App that is attached to a Project."` — which reads like a Project-attachment problem but isn't one; the App genuinely was attached to a Project, just the wrong *kind* of Project. Symptom to watch for: token exchange succeeds, `/2/users/me` (or any other v2 call) fails with that exact text. Fix is a full API access (pay-per-use) Project, not an MCP-access one — see README's "Connecting X" for the portal steps. Diagnosed by tagging `x-oauth-callback`'s thrown errors with which stage failed (`token exchange:` vs `profile fetch:` prefixes) since there's no CLI log access to this project's Edge Function logs (`supabase functions logs` doesn't exist in CLI 2.117.0) — worth keeping that tagging in place for the next platform integration's live-debugging pass.

**Confirmed working end-to-end** (2026-09-16): OAuth connect against a real X account (`@AIUniverseNewsX`) — `social_profiles`(`platform: 'x'`) and `social_profile_secrets` (both `access_token`/`refresh_token` set, ~2h expiry) rows verified directly in the DB. A manually-inserted image post was then published via a direct `publish-scheduled-posts` invocation (curled with the anon key + apikey headers, same as a cron call would send) — flipped to `status: 'published'` with a real tweet id in `platform_media_id`, confirmed live at the resulting tweet URL. This proves the full chunked media upload (INIT → APPEND → FINALIZE) and `POST /2/tweets` path against the real API, no code changes needed after the Portal/Project fix above.

**Still unverified** (revised 2026-09-23 against real DB data — two of the three original items are now confirmed):
- ~~A **video** post through the chunked-upload path~~ — **confirmed**: 7 real videos published through INIT → APPEND → FINALIZE plus the `waitForXMediaReady` STATUS-polling branch.
- ~~**Multi-platform fan-out**~~ — **confirmed**: every post row on all four platforms is `source: auto` (X 40, Facebook 34, Instagram 69, TikTok 14), so the generation functions are genuinely fanning one idea out per connected eligible profile.
- The **refresh-token rotation** assumption in `refreshXTokenIfNeeded` — still unverified; needs `expires_at` forced into the past and a re-run, checking whether the returned `refresh_token` actually differs from the stored one. ~5 minutes of work whenever someone wants to close it.
- **Auto-generated image posts to X have never once succeeded** (1 image published ever, and that was the manual 2026-09-16 test). This is the real open item — see the 2026-09-23 correction above.

**Regression discovered 2026-09-17** (one day after the confirmed-working test above): a real queued X post started failing every run with `tweet create (HTTP 403): You are not permitted to perform this action.` — diagnosed by temporarily tagging `publishToX`'s error paths with which stage failed (`media init:`/`media append:`/`media finalize:`/`tweet create:` prefixes, same technique as the Project-type gotcha above) and, for the `tweet create` stage specifically, dumping the full raw response body once to see its shape. The response was a bare RFC7807 problem — `{"detail":"You are not permitted to perform this action.","status":403,"title":"Forbidden","type":"about:blank"}` — not the `errors[0].message` shape most v2 errors use, so `publishToX`'s fallback to `tweetJson.detail` was added to surface this case instead of a generic "Failed to publish tweet". **Root cause not yet confirmed** (needs the user to check the X Developer Portal), but the shape narrows it: chunked media upload (`media.write`, also a write action) succeeded with the exact same access token, so this isn't a dead/expired/wrong-scope token — it's specific to `POST /2/tweets`. Two candidates to check in the Developer Portal:
1. **App permissions** (User authentication settings) not actually set to "Read and Write" — and even if it now is, an OAuth token minted *before* that setting was last saved doesn't retroactively gain write access; the account needs to be disconnected and reconnected via "Connect X" after confirming the setting, to mint a fresh token.
2. **Pay-per-use billing** on the Project lapsed (payment method declined/removed, or a spend cap hit) — tweet creation is billed per-post per the Sept 2026 pricing change noted above, while media upload itself is not, which would also explain why only the tweet-creation call is rejected.

The stage-tagging added for this (`media init:`/`media append:`/`media finalize:`/`media status:`/`tweet create:` prefixes on every thrown error in `publishToX`/`uploadMediaToX`/`waitForXMediaReady`) was left in place in the deployed code, not reverted — cheap to keep, and this is exactly the kind of failure it exists to localize with no other log access to this project's Edge Functions.

**Ruled out so far**: the Pay-Per-Use Project has credit (confirmed by the user), so this isn't a billing/spend-cap issue. The account was also disconnected and reconnected via "Connect X" (confirmed by `social_profile_secrets.expires_at` advancing to a new value, proving a genuinely fresh OAuth token was minted, not a cached one) — the exact same `tweet create (HTTP 403): You are not permitted to perform this action.` still occurred on the very next `publish-scheduled-posts` run against that fresh token. So this is **not** a stale-token-from-before-a-permissions-change issue either.

This combination — correct-looking App permissions, funded Pay-Per-Use billing, a freshly-minted token, media upload (also a write action) succeeding with that same token, yet `POST /2/tweets` still 403ing — matches multiple unresolved reports on X's own developer forum (e.g. threads titled "Read+Write, funded Pay-Per-Use app" and "tweet.write granted (verified) on Pay-Per-Use" still hitting this exact error) rather than any single app-side misconfiguration this project can fix in code.

**Every app-side lever has now been tried, all with the identical `tweet create (HTTP 403): You are not permitted to perform this action.`**:
1. Confirmed the Pay-Per-Use Project has credit (X's billing docs describe credits as purchased "in the Developer Console" account-wide, not scoped per-Project, so a Project-mismatch theory doesn't apply here anyway).
2. Disconnected and reconnected via "Connect X" — confirmed a genuinely fresh token (`social_profile_secrets.expires_at` advanced) — same error.
3. Regenerated the App's OAuth 2.0 **Client ID and Client Secret** in the X Developer Portal itself (not just the user token) on the theory that App-permission changes only take effect on newly-generated credentials — updated `X_CLIENT_ID`/`X_CLIENT_SECRET` via `supabase secrets set` (no redeploy needed, Edge Functions read `Deno.env` live), reconnected again (confirmed another fresh token) — same error.

At this point this is not something further code changes or Supabase config in this project can fix — it matches an apparent **X platform-side issue**, not an app misconfiguration: one devcommunity.x.com report describes `POST /2/tweets` "worked correctly through late June 2026 but later started returning 403 errors" with no config change on their end, mirroring this account's situation (worked once 2026-09-16, broke by 2026-09-17). **Blocked pending X's support/forum response** — don't re-attempt the credential-regeneration/reconnect cycle again without new information, it's been done twice now with identical results. Instagram, TikTok, and Facebook publishing are all unaffected and continue to work.

### Corrected 2026-09-23 — X is NOT fully blocked (queried against the live DB)

Everything above describes X as persistently, totally blocked since 2026-09-17. **That is wrong**, and it misdirected the diagnosis for a week. Queried directly via PostgREST with the service-role key (`supabase projects api-keys` — the CLI is logged in, so this data was always checkable without a DB password):

| | published | failed | scheduled |
|---|---|---|---|
| **video** | **7** | 5 | 0 |
| **image** | 1 | 24 | 4 |

Real `published_at` timestamps: 2026-09-16 (×3), 09-17, 09-20 (×2), 09-22 (×2) — **spread across days, not a single burst**, so this is not a stuck backlog draining. X has been publishing successfully throughout the window PLAN.md called a total outage.

**The actual pattern is image-vs-video, not working-vs-broken**: video succeeds ~58% of the time, images ~4% — and the single image success was the original 2026-09-16 manual test, so *no auto-generated image post has ever published to X.*

Two further corrections this forces:

- **"Video publish unverified" is wrong** — 7 real videos have published through the chunked upload (INIT → APPEND → FINALIZE) + `waitForXMediaReady` STATUS-polling path. That path is proven; remove it from the unverified list.
- **The 29 `failed` rows are not 29 captured 403s.** All 29 carry a byte-identical, hand-written `failure_reason` referencing PLAN.md ("stopped retrying to halt runaway Storage egress") — an administrative bulk update made today to stop the egress bleed, not per-post errors from X. The true failure reasons for those posts were overwritten and are gone. Any conclusion drawn from their count is unsupported.
- `publish_attempts` is also uninformative for history: the column was added today (0012), so every pre-today row reads `0` regardless of what actually happened.

**Ruled out as the cause of the image/video split**: URLs in the caption (the $0.20-vs-$0.015 billing tier). Checked every X post body — **none** contains a URL, on either the succeeding or failing side.

**Next step to actually diagnose it**: let exactly one auto-generated *image* post through to X and capture the raw error. The stage-tagging (`media init:`/`media append:`/`media finalize:`/`tweet create:`) is still in the deployed code, so a single real attempt will say whether images even fail at tweet-create — which is currently an assumption inherited from the overwritten reasons, not an observation. Until that exists, the enrollment theory below is unconfirmed: it predicts a uniform failure, and the data shows a media-type-dependent one.

### Root cause found and fixed 2026-09-24 — it was our code, not X

**Everything above this heading is wrong about the cause.** Kept, unedited, because the way it went wrong is the lesson.

`truncateForX` did `text.slice(0, 279) + '…'` — exactly 280 JavaScript characters, which looks right and isn't. **X counts *weighted* length**, and `…` (U+2026) falls outside every weight-1 range in X's twitter-text configuration, so it costs **2**. Every truncated tweet was therefore **281 weighted characters — over by exactly one**, and X rejects it with:

```
403 {"detail":"You are not permitted to perform this action.","status":403,"title":"Forbidden","type":"about:blank"}
```

No `reason`, no `client-not-enrolled`, no mention of length. That sentence is the same one X returns for an unenrolled app and for a restricted account, which is what sent this chasing the Developer Portal for a week.

**The evidence was in the database the whole time.** Every X post that ever published had a caption under 280 characters; every post that failed had a 419-502 character auto-generated caption:

| | caption length | result |
|---|---|---|
| Videos (9 published) | 224-257 | ✅ always published |
| The one manual image test (2026-09-16) | short | ✅ published |
| Auto-generated image posts | 419-502 | ❌ never once published |

It was never image-vs-video. **It was truncated-vs-not** — videos just happen to get short captions and image posts get 60-100 word ones. And there was never a "regression on 2026-09-17" either: auto-generated image posts had never worked at any point. The 2026-09-16 success that made it look like a regression was the short manual test.

**What misled the diagnosis, worth naming so it doesn't happen again:**
- The 403's wording invites a permissions hypothesis and gives no evidence for or against one, so every theory built on it was unfalsifiable from the error alone.
- `publishToX` threw away the response body and kept only `detail`, so the (empty) `reason` field — the one thing that would have ruled enrollment out on day one — was never visible.
- The 29 bulk-overwritten `failure_reason` values destroyed the real per-post errors, leaving only 4 genuine ones, all captured after 0012 landed.
- **The decisive check was cheap and available all along**: two videos published at 10:15 and 10:17 on 2026-09-23, *between* image failures at 09:00 and 21:00 the same day. An app that can't create tweets can't create those. One query would have falsified the enrollment theory at any point that week.

**The fix** (in `publish-scheduled-posts`): `truncateForX` now measures X's weighted length via `xCharWeight`/`xWeightedLength`, budgets 23 for a URL (t.co's fixed cost) plus 2 for the ellipsis, iterates code points so an emoji is never split into a lone surrogate, and backs off to a word boundary. `publishToX` also now logs the full 403 body rather than just `detail`.

**Verified live 2026-09-24**, in this order:
1. Same image, same account, same token, short caption → published (tweet `2102977951834992815`). Isolates the caption as the variable.
2. Fix deployed, then a real 493-character auto-generated caption → published (tweet `2102978396825522373`). **The first auto-generated image post ever to publish to X.**
3. Token refresh confirmed working as a side effect: X's access token expires every 2 hours, and the publish run rotated it (`expires_at` moved to 06:24 UTC). Publishes spread across 09-16 → 09-24 were only ever possible through that path, so it has been working all along.

**Still true and still worth knowing**: X bills $0.20 per post containing a URL vs $0.015 without, so Phase 12's inline X links stay off by default.

**One follow-up worth considering**: truncating a 60-100 word caption to 280 characters produces a mid-sentence cut-off post, which is legal but not good. The better fix is asking Claude for a short X-native caption alongside the long one at generation time, rather than amputating the long one at publish time.

### Possible root cause for the failures that do occur (identified 2026-09-23, not yet tried)

The "ruled out" reasoning above contains a specific mistake worth naming, because it's what stalled this for a week: **"the account has credits" and "this App is enrolled in the Pay-Per-Use package" are two different portal states, and only the first was ever confirmed.** The note above reasoned that since X's billing docs describe credits as account-wide rather than per-Project, a Project/billing-linkage theory "doesn't apply" — but account-wide credit is exactly what makes per-App enrollment a *separate* thing that can silently be missing. Funded account, unenrolled App, 403 on the only billed call. That shape fits every symptom observed here:

- Media upload (`/2/media/upload/*`) succeeds on the same token while `POST /2/tweets` 403s — **media upload isn't billed per-use, tweet creation is** (already noted above as a billing-shaped clue, then dismissed).
- It worked once (2026-09-16) and broke the next day with no config change — consistent with an enrollment/propagation state flipping server-side, not with a permissions or token problem.
- Regenerating credentials and reconnecting twice changed nothing — correct, because neither touches App→package enrollment.

Multiple devcommunity threads report the fix as explicitly moving the App onto the Pay-Per-Use package via the Developer Portal's **"Manage apps"** flow, having already added credits and seen no effect from that alone. There is also evidence this is partly a **backend bug X staff fix manually per App**: several thread titles include an App ID posted at a staff member's request, and one is titled "backend enrollment fix requested — App ID 33424400". One thread also references a `client-not-enrolled` reason code, implying client enrollment is a real, distinct server-side state that the generic 403 text doesn't surface.

**Next steps, in order** (all Developer Portal / forum work, no code changes):
1. Find the App ID in the X Developer Portal and check **Manage apps** — confirm this App is listed under the Pay-Per-Use package, not as a standalone App alongside it. If it isn't, move it there. Note the portal warning reported in these threads: credentials issued to a standalone App **do not carry over** when it's moved, so regenerate the OAuth 2.0 Client ID/Secret afterward, re-run `supabase secrets set X_CLIENT_ID=... X_CLIENT_SECRET=...`, and reconnect via "Connect X" to mint a fresh token against the moved App.
2. If the App already shows as enrolled, this is the backend bug: post a new devcommunity thread **including the App ID** and explicitly request a backend enrollment fix, referencing the threads below. That's the path that's actually produced resolutions, not further app-side changes.
3. Only after both: consider account-level restriction on `@AIUniverseNewsX`. Lower probability — X returns a *differently worded* error for that case ("Your account is not permitted to access this feature", [thread 276439](https://devcommunity.x.com/t/post-2-tweets-returns-403-your-account-is-not-permitted-to-access-this-feature/276439)) — but a brand-new account whose entire posting history is automated is exactly the profile X's spam systems flag, and a sudden jump in posting cadence is a documented trigger. If Step 1 and 2 both come back clean, check the account for a restriction notice before writing more code.

**Cost note for whenever this unblocks**: X bills **$0.20 per post containing a URL vs. $0.015 without** — 13x. Phase 12's plan to append tracked short links to captions makes every X post the expensive kind, so that's a deliberate per-platform decision (see Phase 12 Step 1), not something to switch on globally without doing the math against what X actually converts.

Related reports on devcommunity.x.com describing the same symptom under seemingly-correct configuration (worth linking when filing a new report there, or checking for a staff response):
- [POST /2/tweets returns 403 "not permitted" on a Read+Write, funded Pay-Per-Use app](https://devcommunity.x.com/t/post-2-tweets-returns-403-not-permitted-on-a-read-write-funded-pay-per-use-app/274069)
- [POST /2/tweets 403 with tweet.write granted (verified) on Pay-Per-Use](https://devcommunity.x.com/t/post-2-tweets-403-you-are-not-permitted-to-perform-this-action-with-tweet-write-granted-verified-on-pay-per-use/273196)
- [POST /2/tweets returns 403 despite correct permissions, Project attachment, and paid credits](https://devcommunity.x.com/t/post-2-tweets-returns-403-not-permitted-despite-correct-permissions-project-attachment-and-paid-credits/271336)
- [Pay-Per-Use: POST /2/tweets 403, all settings correct, moving app to Production didn't help](https://devcommunity.x.com/t/pay-per-use-post-2-tweets-returns-403-you-are-not-permitted-to-perform-this-action-all-settings-correct-moving-app-to-production-didnt-help/270946)
- [Pay-Per-Use: app is standalone (not Project-attached), permissions correct, credit available](https://devcommunity.x.com/t/pay-per-use-post-2-tweets-returns-403-you-are-not-permitted-to-perform-this-action-app-is-standalone-not-project-attached-permissions-correct-credit-available/271232) — closest match to the enrollment theory above
- [Pay Per Use: 403 with no `client-not-enrolled` reason — App ID 33282140](https://devcommunity.x.com/t/pay-per-use-post-2-tweets-returns-403-you-are-not-permitted-to-perform-this-action-no-client-not-enrolled-reason-app-id-33282140/272655) — evidence that client enrollment is a distinct server-side state
- [Pay-Per-Use app: backend enrollment fix requested — App ID 33424400](https://devcommunity.x.com/t/pay-per-use-app-oauth-1-0a-request-token-returns-403-backend-enrollment-fix-requested-app-id-33424400/275637) — the staff-fix-by-App-ID path
- [POST /2/tweets 403 on Pay Per Use app, App ID 33356113 (per taycaldwell's request in another thread)](https://devcommunity.x.com/t/post-2-tweets-returns-403-forbidden-on-pay-per-use-app-app-id-33356113-per-taycaldwells-request-in-another-thread/275910) — staff member actively collecting App IDs for this
- [403 "not permitted" on POST /2/tweets for one specific account](https://devcommunity.x.com/t/403-you-are-not-permitted-to-perform-this-action-on-post-2-tweets-for-one-specific-account/276217)
- [POST /2/tweets 403 "not permitted" — GET /2/users/me succeeds with read-write-directmessages](https://devcommunity.x.com/t/pay-per-use-post-2-tweets-returns-403-not-permitted-get-2-users-me-succeeds-with-read-write-directmessages/274278)

## Phase 11 — Facebook Page integration (built, not yet confirmed against a real account)

Adds a Facebook Page (AI Universe News's own Page, not a personal profile) as a fourth connectable/publishable platform. Unlike TikTok/X, this needed **no new OAuth app or provider research** — it reuses the exact Meta app and Page-linked Facebook Login for Business flow Instagram already uses (Phase 4), since Instagram's own callback already fetches the Page and its access token as an intermediate step on the way to the linked Instagram Business Account. Facebook's flow just stops one step earlier and stores the Page itself.

- Schema (`0011_facebook_oauth.sql`): `'facebook'` added to both `social_profiles.platform` and `oauth_states.provider` check constraints. No new tables — reuses `oauth_states`/`social_profiles`/`social_profile_secrets` as-is.
- `supabase/functions/facebook-oauth-start` (JWT-verified): same shape as `instagram-oauth-start`, `provider: 'facebook'`. Scopes: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` — `pages_manage_posts` is the one addition Instagram's flow doesn't need, since Instagram only ever reads the Page (to find its linked IG Business Account) rather than posting to it directly.
- `supabase/functions/facebook-oauth-callback` (`--no-verify-jwt`): same token exchange (short-lived → long-lived user token) as Instagram's callback, then `GET /me/accounts?fields=id,name,access_token,fan_count,category` and stops there — no Instagram Business Account lookup. Stores the Page's own `id` as `social_profiles.external_id` and the Page access token (the same *kind* of token Instagram's flow stores, just used for the Page's own feed instead of its linked IG account) as the secret.
- **Needs its own redirect URI**, `FACEBOOK_REDIRECT_URI`, distinct from `META_REDIRECT_URI` — Meta requires an exact registered match per callback URL, so the two flows can't share one even though they share `META_APP_ID`/`META_APP_SECRET`.
- `publish-scheduled-posts`: `publishToFacebook` posts directly to `/{page-id}/photos` (param `url` + `caption`) or `/{page-id}/videos` (param `file_url` + `description`) depending on `media_type` — no container-create-then-publish step the way Instagram's Content Publishing API needs; a Page feed post's source-URL upload returns the published post id synchronously.
- Fan-out: `'facebook'` added alongside `instagram`/`x` in `generate-trend-posts`' image-eligible platform list, and alongside `instagram`/`tiktok`/`x` in `generate-reel-posts`' video-eligible list — a connected Facebook Page gets both auto-drafted images and Reels-equivalent video posts, same as Instagram.
- Frontend: "Connect Facebook" button + `fb_connected`/`fb_error` banner on Profiles (mirrors X/TikTok); `'facebook'` added to the manual-add platform picker.

**Confirmed live 2026-09-23** (queried against the production DB; this section previously said "not yet verified," which was stale by six days):

- `social_profiles` row `platform: facebook` ("News & media website"), `connection_status: connected`, created **2026-09-17** — both OAuth functions are deployed and ACTIVE, so the connect flow ran for real.
- **30 posts published**: 20 `image` (the `/{page-id}/photos` path) and 10 `video` (the `/{page-id}/videos` path) — *both* publish branches proven, not just one.
- All 30 carry a real `platform_media_id`, shaped as Facebook's `{page-id}_{post-id}` for photos (e.g. `1278429148691685_122114798859464677`) and a bare id for videos.
- Continuous operation 2026-09-17 → 2026-09-22, all `source: auto` — this is the unattended pipeline running, not hand-placed test posts.

**The one residual check** is the part no database query can answer: that the posts are actually *visible on the Page*. A Graph API success returning a post id proves the call was accepted, not that the result is publicly visible (a Page post can be published but restricted). Eyeball the Page once and this phase is fully closed.

## Phase 12 — Monetization (Steps 1-3 built + deployed 2026-09-24, not yet verified against real data; Steps 4-6 planned)

### The gap this closes

Phases 1-11 built two systems that have never been connected to each other:

- A **content pipeline** that researches trends, generates images/video, and publishes autonomously to four platforms.
- A **revenue-attribution stack** (`short_links` → `redirect` → `link_clicks` → `subId1` → `impact-conversion-postback` → `revenue_events`) that is fully built, deployed, and idle.

Neither `generate-trend-posts` nor `generate-reel-posts` contains a single reference to `short_links` — confirmed by grep, not assumed. Every auto-published post therefore goes out with **no offer attached and nothing tracked**, and the only monetization path in existence is one affiliate link manually pasted into the Instagram bio. The measurement system for revenue was built before the revenue was.

Second constraint to design around: **Instagram and X are the live channels; TikTok and Facebook are not.** TikTok publishes `SELF_ONLY` until its audit clears (zero public reach, so zero clicks by construction) and Facebook is unverified. X is partially live — video posts publish, auto-generated image posts have never succeeded (see Phase 10's 2026-09-23 correction) — so X counts for Reels but not for image content until that's diagnosed.

This matters for Step 1's link placement: **X and Facebook are the only platforms with clickable captions**, and of those, X is the only one currently publishing. So X is where inline tracked links actually reach anyone — which makes the **$0.20-per-post-with-a-URL vs $0.015-without** billing tier a live cost decision on the working half of the X pipeline, not a hypothetical.

### Verified end-to-end 2026-09-24

Two real `generate-trend-posts` runs against the live project, with the first live offer (Amazon Associates → `https://amzn.to/4xn6snt`, the link that had been sitting manually pasted in the Instagram bio since Phase 3). Observed, not inferred:

- `created: 3, linksCreated: 3` — one short link per post row. Three rows because three image-capable platforms are connected; TikTok is correctly excluded from image posts.
- **Caption placement is right per platform**: Instagram and X captions carry no URL, the Facebook caption carries the URL *and* the disclosure. X inline links stayed off, as configured.
- One generated image shared across all three rows; a distinct slug per row.
- `redirect/<slug>` → `302` to `https://amzn.to/4xn6snt?utm_source=facebook&utm_medium=social&utm_campaign=ai-gadgets&subId1=<slug>`. **`utm_source` differs per platform row, so per-platform attribution works.**
- A `link_clicks` row landed against the right `affiliate_offer_id`.
- `performanceDigest: "included"` after the gate fix below.

**Five real problems this surfaced that code review had not:**

1. **The deployed `redirect` was stale.** It predated the commit that added `subId1`, so the live `Location` header had no `subId1` at all — the repo was right and production was months behind. Redeployed. Same class of drift as migration 0005: *being in the repo is not evidence of being deployed.*
2. **The digest gate was decided by an arbitrary fetch window.** It fetched the 60 most recent published rows and filtered `reach > 0` in JS. Against real data: 136 published rows, only **19** with metrics in the newest 60 — so the digest was suppressed at 19/20 while **51** qualifying posts existed. The cause is the fan-out: three of every four rows are X/Facebook/TikTok, which have no insights sync and can never have reach, so "recent rows" is a terrible proxy for "rows with data". Fixed by filtering `reach > 0` in SQL and dropping the window entirely.
3. **The model wrote link-aware copy for platforms with no link.** The first run's captions ended `"Meanwhile, the AI gear that already works is here →"` — fine on Facebook, pointing at nothing on Instagram and X. Fixed with an explicit prompt constraint that the caption must read naturally with no link in it, since the URL is only appended on some platforms. Verified gone on the second run.
4. **An undisclosed affiliate link would have auto-published.** Posts go out unattended, so every Facebook caption would have carried an Amazon affiliate link with no disclosure — violating both the FTC endorsement guides and Amazon's Associates agreement. Added `affiliate_offers.disclosure` (migration `0017`), appended with the link wherever it appears, surfaced in the Offers UI, and flagged there when an active offer has none.
5. **`utm_campaign` was raw hashtag text.** The post's `tag` went in verbatim, so campaigns arrived as `%23MetaCharm+%23AIgadgets+%23MetaConnect`. Now normalized to `ai-gadgets` via `campaignSlug()`.

**The digest is technically on but currently worthless, and this is worth watching.** The 20 rows now feeding the prompt have a median reach of **1**, 16 of 20 have reach ≤ 2, and **total clicks across all of them is 0**. The gate counts posts with metrics, not whether those metrics carry information — so the model is being told to "bias toward the top quartile by clicks-per-reach" across twenty posts that all have zero clicks. That can only teach noise, which is exactly what the gate was meant to prevent. **Recommended: add a minimum-reach floor (or require non-zero total clicks) before this is trusted to steer generation.** One-line change in `fetchPerformanceDigest`; left as a decision rather than made unilaterally, since the right threshold depends on when the account is expected to grow.

### What was built and deployed 2026-09-24

- Migrations `0013_affiliate_offers.sql` (offers table, `short_links.affiliate_offer_id`, a partial index on `short_links.post_id`, `automation_settings.x_inline_links_enabled`), `0014_bio_page.sql` (bio config on `automation_settings`), `0016_post_performance.sql` (the `post_performance` view). **All applied** via `supabase db push`.
- Functions deployed: `generate-trend-posts`, `generate-reel-posts`, `publish-scheduled-posts`, and `bio` (with `--no-verify-jwt`). The CLI uploads `_shared/monetization.ts` alongside each function that imports it — confirmed in the deploy output, so the shared-module pattern does work with `supabase functions deploy`.
- **Verified**: `GET /functions/v1/bio/<anything>` returns 404 with no `bio_slug` configured, so deploying the page didn't expose anyone's post history.

### Schema drift found while deploying this (important, and not specific to Phase 12)

`0016_post_performance.sql` failed on first push with `column re.status does not exist` — **migration `0005_impact_revenue_postback.sql` is recorded as applied in the remote migration history, but its columns were never actually there.** `supabase db push` only consults that history, so it will never re-run 0005 on its own; the drift is invisible to the normal workflow and was only surfaced by a view that happened to reference the missing column.

This had been silently wrong in production since Phase 7: `RevenueEventRow` declares `status`/`external_ref` and the Revenue page reads `event.status` (filtering `reversed` out of the chart, labelling `pending`), so all of those reads had been comparing against `undefined`. It went unnoticed because Phase 7 is dead — nothing was ever *writing* those columns.

Repaired by `0015_revenue_events_status_repair.sql`, written idempotently (`add column if not exists` / an `information_schema` guard / `create unique index if not exists`) so it is safe on a database where 0005 did apply. **Worth remembering: a recorded-but-unapplied migration is a failure mode this project has actually hit once, so `supabase gen types typescript --linked` is the cheap way to check the real schema when something unexplainable happens** — it dumps the live column list without needing a DB password.
- `supabase/functions/_shared/monetization.ts` — **a new pattern for this repo**: every function so far has been self-contained, with small helpers (`extractJsonArray`) duplicated between them. This one is shared because the offer-matching, link-creation, and digest logic is ~150 lines with real failure modes, and a divergence between the image and video pipelines would silently mean one of them stops earning. Supabase's CLI bundles relative imports outside the function directory, so `_shared` deploys with each function and is not itself deployable.
- Offer matching + per-post-row short links in both generation functions, the public `bio` function, and the performance digest in both prompts.
- `truncateForX` in `publish-scheduled-posts` is now URL-aware (see Step 1 below for why that isn't cosmetic).
- Frontend: an Offers panel on the Revenue page (with per-offer click counts), and X-inline-links + bio-page fields on Settings.

### Ordering principle

Steps 1-3 pay off at *any* audience size and reuse infrastructure already paid for. Steps 4-5 scale with audience and pay nothing until there is one. Step 6 has the highest ceiling and the longest lead time, because its blocker is platform review, not code. **Do 1-3 first** — they're roughly three days of work total and they're what switches the existing attribution stack on.

### Step 1 — Attach an offer to every generated post (built, not deployed)

The core fix. Migration `0013_affiliate_offers.sql`:

```
affiliate_offers (id, user_id, program_name, destination_url, keywords text[],
                  category, priority int, active bool, created_at)
```
RLS `owner rw`, same pattern as every other owner table.

**Where the offers come from — open prerequisite (2026-09-23).** This step assumed Impact tracking links as `destination_url`. The Impact account was rejected, so **there is currently no affiliate program to point offers at**, and this is now the gating decision for the whole step. Options, in the order I'd try them: a direct program from an AI tool already covered in the content (usually Rewardful/FirstPromoter/Tolt, usually easy approval, often webhook-capable), PartnerStack, or ShareASale/Awin/CJ. See Phase 7's revised section for detail.

Worth noting this doesn't block the step's *code*: `affiliate_offers` rows can point at anything — a newsletter signup (Step 4), a product, a landing page — and the click-tracking half works identically. An offer table with one row pointing at your own newsletter is a perfectly valid first deployment, and it makes Step 1 shippable before any network approves.

In both generation functions, after Claude drafts an idea, match it to an offer and create a `short_links` row pointing at that offer's `destination_url`. **Have Claude pick the offer inside the existing call** rather than adding a second API call or writing a keyword matcher: pass the active offer list into the prompt and add an `offer_id` field to the JSON response schema it already returns. Validate the returned id against the real offer list in code and fall back to the highest-`priority` active offer if it hallucinates one — a post must never end up link-less, since a link-less post is the exact failure mode this whole phase exists to fix.

**Create one short link per post row, not per idea.** Fan-out already produces one `posts` row per platform per idea, and `short_links.post_id` is a single-post FK, so per-row is both the natural shape and free per-platform attribution — you learn whether Instagram or Facebook actually converts, which nothing currently tells you.

**Implementation notes worth not re-deriving:**
- **Post ids are generated in the function** (`crypto.randomUUID()`) rather than left to the column default. The short link has to be built *before* the caption is written (the URL goes in the caption on clickable-caption platforms) but inserted *after* the post (`short_links.post_id` is a real FK), and matching returned rows back to input rows would otherwise depend on PostgREST returning inserted rows in input order — which isn't guaranteed.
- **Short links are inserted one row at a time**, not as a batch: a slug collision or any other single-row failure in a batch insert would abort the whole batch and leave every post in that run link-less, which is worse than losing one link.
- **Zero offers is a supported state, not an error path.** No active offers means posts generate and publish exactly as they did before this phase, untracked. This is the expected state right now, since no affiliate network is approved.
- **`truncateForX` had to change.** It truncated to 280 chars blindly, which with a link appended would slice the URL in half — producing a tweet that's both unclickable *and* billed at X's $0.20 with-a-URL rate instead of $0.015. It now preserves a trailing URL and truncates only the body above it. (It counts the raw URL length; X wraps every URL to a 23-char t.co link, so this over-counts, erring toward a slightly shorter tweet rather than a rejected one.)

**Link placement differs per platform, and this matters:**
- **X and Facebook**: captions are clickable — put the short URL inline.
- **Instagram and TikTok**: captions are **not** clickable (the Phase 3 finding that motivated the bio-link approach in the first place) — the link has to reach the audience via the bio page in Step 2. Writing a URL into an Instagram caption accomplishes nothing but taking up caption space.
- **X cost caveat**: X bills **$0.20/post with a URL vs $0.015 without** — 13x. Gate inline X links behind a setting (default off) and revisit once X is unblocked and there's real conversion data to justify it.

### Step 2 — Link-in-bio page

Instagram gives one bio link; this turns it into N. New public Edge Function `supabase/functions/bio` (`--no-verify-jwt`, same reasoning as `redirect` — real people hit it with no Supabase session), serving a page that lists recent published posts each linking to its Step 1 short link. Every link on it points at `/functions/v1/redirect/<slug>`, so clicks log through the existing path with no new tracking code.

Page config (headline, avatar, handle) fits as columns on `automation_settings` rather than a new table — it's one row per user already. Pure conversion-rate gain on traffic that already exists; no new audience required.

**BLOCKED 2026-09-24: the HTML cannot be served from the default Supabase domain.** Verified against the deployed function — Supabase's gateway rewrites an Edge Function's `text/html` response to `text/plain` and attaches `content-security-policy: default-src 'none'; sandbox`, so a browser shows the markup as source instead of rendering it. It's an anti-phishing measure on the shared `*.supabase.co` domain, not something a response header can opt out of. (`redirect` is unaffected: a 302 isn't HTML. This is also why the plan's original "serve a page from an Edge Function" design passed review — the existing public function never had to return markup.)

Everything *behind* the page is verified working: `?format=json` on the same endpoint returns the real content, and against live data it returned 24 cards, **zero duplicate titles** (the fan-out dedup works), published posts only, correct HTML escaping, and the handle rendered. Only the last hop — HTML reaching a browser — is blocked.

**Three ways forward, cheapest first:**
1. **Host the front end publicly** (Vercel/Netlify free tier) and add a public `/bio/:slug` route that renders the JSON this function already returns. The app currently runs only on localhost, so this is the missing piece anyway — an Instagram bio link needs a public URL regardless.
2. **Supabase custom domain** (paid add-on). Then the existing HTML path works untouched.
3. Any static host (GitHub Pages) fetching the same JSON.

The JSON endpoint is deliberately shaped so none of these require changing this function again.

**As built:** served at `/functions/v1/bio/<bio_slug>`, where `bio_slug` is unique and **null means the page is off** — so deploying the function doesn't expose anyone's post history until they deliberately set an address. Posts are **deduplicated by title** before rendering, because the platform fan-out means one idea is several published rows and a bio page listing the same post four times is worse than useless. A trailing URL is stripped from the caption preview (it's already in the caption on X/Facebook, and the whole card is the link here). The page is self-contained — no external CSS, fonts, or scripts — so it can't break on a CDN and loads fast on mobile, which is the only way anyone will open it. `noindex`, 5-minute cache. Posts predating this phase (or created while no offers existed) have no link and render as non-clickable cards rather than being hidden.

### Step 3 — Feed performance back into generation (built, not deployed)

The pipeline currently has no idea which of its posts worked. You already sync real per-post `platform_metrics` (reach, likes, comments, saves, shares, views) and log `link_clicks`, so the data is sitting there unused by the thing that would benefit most from it.

Add a `post_performance` SQL view (migration) joining `posts` → `platform_metrics` → click counts → `revenue_events`, so the Edge Functions do one query instead of N. Note the view is queried service-role-side from Deno, so the frontend's hand-rolled-types/no-`Relationships` limitation (Phase 3) doesn't apply here.

Both generation functions then include a compact digest of the last ~20 published posts (title, topic, format, reach, clicks, revenue) in the Claude prompt, instructed to bias toward the top quartile by clicks-per-reach and away from the bottom. **Gate the whole block behind a minimum post count** (~20 with metrics) and omit it entirely below that — under-powered data would just teach the model noise, confidently.

This is the highest leverage per line of code in the phase: it compounds, and it improves every other step's output for free.

**Two things in the view that are easy to get wrong:**
- **Per-post metrics are taken as `max` per metric name across dates, not `sum`.** `platform_metrics` stores one row per metric per day and Instagram's per-media insights are *lifetime cumulative*, so summing the daily rows multiplies a post's reach by however many days it has been synced.
- **The digest gate reads "20 posts with metrics", not "the last 20 posts all have metrics".** The query fetches 60 published posts and filters to those with `reach > 0` before checking the minimum — fetching exactly 20 and then filtering would have made the gate almost impossible to satisfy, since the most recent posts are exactly the ones whose insights haven't synced yet. A post with no metrics yet reads as a zero-reach failure, which would teach precisely the wrong lesson, so those rows are excluded rather than included as zeros.

### Step 4 — Newsletter off research already being paid for

The daily Claude + web-search call already produces researched trend material that's used for one caption and discarded. `posts.trend_source` (jsonb) already persists it — the raw material for a daily email exists at zero marginal cost.

- `subscribers` table (email, confirmed_at, unsubscribed_at, source) with **double opt-in**.
- `newsletter-subscribe` public function + a capture form on the Step 2 bio page.
- `generate-newsletter` (daily cron) composing an issue from the day's `trend_source` rows, sent via Resend/Postmark.
- Affiliate links in issues go through the same `short_links`/`redirect` stack, so email and social revenue land in one attribution model rather than two.
- **Compliance is not optional**: unsubscribe link and a physical mailing address in every issue (CAN-SPAM), and honor `unsubscribed_at` on send.

Strategic point: an email list is the only asset in this project not rented from a platform that can cut you off without warning — which is not hypothetical here, it's what X did on 2026-09-17.

### Step 5 — Media kit + sponsorship tracking

`sponsorships` table (sponsor_name, rate, status, linked post/slot dates, deliverables), sponsored posts as queue slots that take priority over auto-generated ones, and a public media-kit page generated from the real `platform_metrics` already being synced. Per-unit revenue is orders of magnitude above affiliate clicks, but it's gated on audience size — build when there's reach to sell.

### Step 6 — Productize the tool (highest ceiling, longest lead time)

The schema is **already multi-tenant**: every table is `user_id`-scoped with RLS on `auth.uid()`. What's missing is Stripe subscriptions + entitlement gating, signup flow, per-user platform credentials, and — critically — **per-user cost metering**. Seedance video runs 10-20x an image, so an unmetered subscriber can be net-negative; meter before selling, not after.

**Know the real blocker before starting**: connecting *other people's* accounts requires full Meta App Review and TikTok's Content Posting audit — precisely what Phase 4 avoided by only ever connecting the developer's own account, and what Phase 8 is still waiting on. That's weeks of review latency, not weeks of code. The compensating asset is that this repo's accumulated integration knowledge (the Meta Use Cases gate, TikTok's Creator Info requirement and signature-file quirk, X's Project-type trap) is exactly what competitors burn weeks rediscovering.

### Verification additions for this phase

**Most of these are now done — see "Verified end-to-end 2026-09-24" above.** Still outstanding: the multi-offer selection and hallucinated-`offer_id` fallback (needs a second offer), X inline links in the on state, the X over-length-with-link truncation case, and the zero-offer path. Everything else needs a real `generate-trend-posts` run, which costs real Claude + OpenAI spend and produces posts that auto-publish with no review step — so it's a deliberate, attended action, not something to fire off casually.

- `affiliate_offers`: insert two offers, run `generate-trend-posts`, confirm every created post row has a matching `short_links` row and that a hallucinated/absent `offer_id` falls back to the priority offer rather than producing a link-less post. ✅ Done 2026-09-24 with one offer — `created: 3, linksCreated: 3` on both runs. The multi-offer selection and the hallucinated-id fallback are still unexercised: with a single active offer every path returns the same row.
- Zero-offer path: with no active offers, run `generate-trend-posts` and confirm posts are still created (untracked, `linksCreated: 0`) rather than the run failing.
- Caption placement: confirm an Instagram row's `body` has **no** URL, a Facebook row's does, and an X row's does **not** until `x_inline_links_enabled` is turned on — then does. ✅ Done 2026-09-24 for the off state; the on state for X is still untested.
- X truncation: publish an X post whose caption plus link exceeds 280 chars and confirm the tweet ends with a complete, clickable short URL rather than a severed one.
- Bio page off by default: hit `/functions/v1/bio/<anything>` with no `bio_slug` set anywhere and confirm a 404, not an empty page. ✅ Done 2026-09-24 — 404 on both `/bio` and `/bio/<unknown-slug>`.
- Per-platform attribution: with two platforms connected, confirm one idea produces distinct slugs per platform row, and that clicking each logs a `link_clicks` row against the right one. ✅ Done 2026-09-24 — three distinct slugs, `utm_source` per platform, click logged against the right offer.
- Bio page: load it unauthenticated, confirm it renders published posts only (no drafts/failed), and that each link 302s through `redirect` with `subId1` appended. 🟡 Partially done 2026-09-24 — content verified via `?format=json` (24 posts, published-only, deduplicated); the HTML rendering is blocked by the gateway (see above), and no post has a link yet because no offer exists.
- Feedback loop: with fewer than the minimum posts, confirm the digest block is omitted from the prompt entirely rather than sent empty or partial. ✅ Both branches observed 2026-09-24 — omitted at 19 qualifying rows, `performanceDigest: "included"` at 20+ after the gate fix.
- Newsletter: confirm double opt-in (an unconfirmed subscriber never receives a send) and that `unsubscribed_at` is honored.

---

## Verification checklist

- `npm run dev` and manually walk each route: log in via magic link, add a profile, add a post, add a revenue event, confirm Overview's metric cards/chart/queue reflect real Supabase data.
- `npm run build` (runs `tsc -b`) — no type errors, particularly around `verbatimModuleSyntax` and the hand-rolled Supabase types.
- `npm run lint` (oxlint) clean.
- RLS: confirm a second test account (or Supabase SQL editor "run as authenticated user") cannot see another user's rows.
- `generate-trend-posts`: with `auto_posting_enabled = false`, invoke manually and confirm it exits without inserting rows; flip on, re-invoke, confirm posts appear with `source = 'auto'`, a populated `trend_source`, and content respecting the blocklist/brand voice.
- `generate-reel-posts` / `check-video-jobs`: submit a job, poll until `status: "ready"` in the response, then actually watch the downloaded video before trusting it to run unattended. Also confirm the failure path: a Seedance-rejected job should leave the post visible in the Content Queue as `status: 'failed'` with `failure_reason` populated, not silently disappear.
- End-to-end publish: confirm a real Instagram media ID comes back from `publish-scheduled-posts`, for both an image post and a video Reel.
- Impact postback: curl `redirect/<slug>` and confirm the `Location` header includes `subId1=<slug>`; curl `impact-conversion-postback` with a matching `subid1` and `status=APPROVED`, confirm a `revenue_events` row appears with `status: confirmed`; re-send the same `action_id` with `status=REVERSED` and confirm the same row updates rather than duplicating.
- TikTok connect: click "Connect TikTok" on Profiles, approve, confirm a `social_profiles` row appears with `platform: tiktok` and a `social_profile_secrets` row with both `access_token` and `refresh_token` set.
- TikTok publish: schedule a video post against the connected TikTok profile, run `publish-scheduled-posts`, confirm it flips to `published` with a `platform_media_id` set (expect `SELF_ONLY` visibility pre-audit); manually force `expires_at` into the past on the secret row and re-run to confirm the token-refresh path also works.
- Instagram insights: deploy and invoke `sync-instagram-insights` manually against a connected account with a post older than 24h; confirm `platform_metrics` rows appear for both account-level and post-level metrics, and re-invoking the same day updates rows in place rather than duplicating (check row counts before/after). ✅ Done 2026-09-14 — 93 rows, idempotent on re-invoke, running hourly via cron.
- X connect: click "Connect X" on Profiles, approve, confirm a `social_profiles` row appears with `platform: x` and a `social_profile_secrets` row with both `access_token` and `refresh_token` set. ✅ Done 2026-09-16 — connected `@AIUniverseNewsX`.
- X publish (image): schedule an image post against the connected X profile, run `publish-scheduled-posts`, confirm it flips to `published` with a real tweet id in `platform_media_id`. ✅ Done 2026-09-16 — real tweet published via the chunked media upload + `/2/tweets` path.
- X publish (video) + token refresh: same as above for a video post; manually force `expires_at` into the past on the secret row and re-run to confirm the token-refresh path works and check whether `refresh_token` actually rotates. ✅ Done — video publishing proven by 9 real published posts, and the refresh path confirmed 2026-09-24 (X's 2-hour token was rotated during a live publish run, `expires_at` moving forward). Forcing `expires_at` manually was never needed: publishes spread across 09-16 → 09-24 are only possible through that path.
- X publish (auto-generated image): ✅ Done 2026-09-24 — a real 493-character auto-generated caption published (tweet `2102978396825522373`) after the `truncateForX` weighted-length fix. This had never worked before that fix.
- Facebook connect: click "Connect Facebook" on Profiles, approve, confirm a `social_profiles` row appears with `platform: facebook` and a `social_profile_secrets` row with an `access_token` set. **Not yet done.**
- Facebook publish (image + video): schedule an image post and a video post against the connected Facebook profile, run `publish-scheduled-posts`, confirm both flip to `published` with a real post id in `platform_media_id`, and check the Page itself to confirm they actually appear there. **Not yet done.**
- Multi-platform fan-out: with two or more eligible platforms connected, run `generate-trend-posts`/`generate-reel-posts` and confirm one post row is created per connected eligible profile from a single idea (same `title`/`media_url`, different `social_profile_id`), and that the Content Queue shows a distinct platform label per row rather than what looks like duplicates. **Not yet done.**
