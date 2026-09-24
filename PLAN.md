# Social Media Manager — Build Plan & Status

Current state and what to do next. **The hard-won detail lives in
[NOTES.md](NOTES.md)** — exact API corrections, portal settings that aren't
documented anywhere obvious, and writeups of the failures behind each
integration. This file stays short on purpose; read the relevant NOTES.md
phase before touching an integration.

## What this is

Copilot's first pass produced a polished but entirely fake dashboard —
hardcoded arrays, no backend. Everything since has been making it real:
content that publishes itself, and revenue actually attributed to it.

Standing decisions:

- **Revenue attribution**: affiliate/UTM short links with click tracking (not Stripe/Shopify sync).
- **Backend**: Supabase (Postgres + Auth + Edge Functions + Storage).
- **Tenancy**: single-owner schema, though every table is already `user_id`-scoped with RLS.
- **No review step**: posts are auto-drafted from trending topics and auto-scheduled with no human approval before going out.
- **Design system**: the hand-written CSS in `src/App.css` stays (dark sidebar, coral/yellow/blue, DM Mono for numbers). No Tailwind, no component library — deliberate, not an oversight.

> **Standing risk flag**: unreviewed AI-drafted content about trending news,
> posted autonomously to public accounts, carries real brand-safety risk —
> wrong facts on a fast-moving story, tone-deaf timing, an off-brand joke.
> Manual review was explicitly declined. The safety net is a topic blocklist
> plus a kill switch (`automation_settings.auto_posting_enabled`, default
> **off**) — a way to stop it fast, not a way to catch it first. Worth
> revisiting periodically.

## Status

| Phase | What | Status |
|---|---|---|
| 1-6 | Foundations, auto-drafted posts, short links, Instagram OAuth, image generation + publish, video Reels | ✅ Live |
| 7 | Impact.com revenue reconciliation | ⛔ Dead — publisher account rejected. Code exists, unusable |
| 8 | TikTok integration | 🟡 Works via Sandbox; **waiting on TikTok App Review** for public posting |
| 9 | Real Instagram insights | ✅ Live — hourly sync into `platform_metrics` |
| 10 | X integration + multi-platform fan-out | ✅ Live — fixed 2026-09-24 |
| 11 | Facebook Page integration | ✅ Live since 09-17 |
| 12 | Monetization (offers, tracked links, bio page, feedback loop) | ✅ Steps 1-3 live and verified 2026-09-24. Steps 4-6 not started |

Four platforms connected (Instagram, X, Facebook, TikTok). One idea fans out
to one post row per eligible platform, each with its own tracked link.
TikTok posts `SELF_ONLY` until its audit clears, so it has no public reach
yet.

## Start here

1. **Decide the performance-digest floor.** The Step 3 feedback loop is on, but its 20 rows have a median reach of **1** and zero clicks total — it is currently teaching the model noise, which is what the gate was meant to prevent. The gate counts posts *with* metrics, not whether those metrics mean anything. Add a minimum-reach floor (or require non-zero clicks) in `fetchPerformanceDigest`. One line; the threshold is a judgment call about when the account is expected to grow.
2. **Host the bio page.** Step 2 works but its HTML can't be served from `*.supabase.co` — Supabase rewrites Edge Function `text/html` to `text/plain` with a sandboxing CSP. `?format=json` returns the content, so what's left is a front end to render it: a free Vercel/Netlify deploy of this app with a public `/bio/:slug` route, or a Supabase custom domain. The app currently runs only on localhost, and an Instagram bio link needs a public URL regardless.
3. **Add more offers.** Only one exists (Amazon Associates). Multi-offer selection and the hallucinated-`offer_id` fallback are both unexercised, because with a single active offer every code path returns the same row. Any affiliate link, product page, or your own newsletter works — see NOTES.md Step 1.
4. **Check TikTok App Review.** On approval: set `TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE` and swap `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` from Sandbox to Production.
5. **Then Phase 12 Step 4** (newsletter) — below.

Still unverified, each needing a specific setup rather than being suspected
broken: multi-offer selection, the `offer_id` fallback, X inline links in the
*on* state, the X over-length-with-link truncation path, and the zero-offer
path.

## Traps that have actually bitten

These recur across integrations, and each one cost real time:

- **Being in the repo is not being deployed.** The live `redirect` was months behind the committed code (no `subId1`), found only by curling it. Check the deployed artifact, not the file.
- **A recorded migration is not an applied migration.** `0005` sat in the migration history with its columns absent, so `db push` would never re-run it. `supabase gen types typescript --linked` dumps the live schema and is the cheap way to check.
- **A generic error is not evidence.** X's `403 You are not permitted to perform this action` reads like a permissions problem and means nothing of the sort. A week went into portal settings before anyone queried the database, where the answer had been sitting all along. Prefer a query that can *falsify* the theory over another fix attempt.
- **Models can't count characters.** Asking for "at most 280 characters" overshot twice; asking for "at most 35 words" landed first try.
- **X counts weighted characters** — `…` and emoji cost 2, any URL costs exactly 23. See NOTES.md Phase 10.
- **Edge Functions have a hard 150s limit**, so image generation runs concurrently and is capped per invocation.
- **Cron HTTP timeout is capped at 5000ms** and can't be raised. The function keeps running server-side past it, so `posts.status` is the source of truth, not the cron log.
- **Cron jobs need explicit `apikey` + `Authorization` headers**; the trigger sends none, and the function 401s without them.
- **Supabase won't serve HTML from an Edge Function** on the shared domain.

## Phase 12 — remaining steps

Steps 1-3 (offers → tracked links → bio page → feedback loop) are done; their
implementation notes are in [NOTES.md](NOTES.md).

The ordering principle for what's left: **Steps 1-3 paid off at any audience
size** and reused infrastructure already built. **Steps 4-5 scale with
audience and pay nothing until there is one.** Step 6 has the highest ceiling
and the longest lead time, because its blocker is platform review, not code.

### Step 4 — Newsletter, off research already being paid for

The daily Claude + web-search call produces researched trend material that's
used for one caption and discarded. `posts.trend_source` (jsonb) already
persists it, so a daily email costs nothing extra to source.

- `subscribers` table (email, confirmed_at, unsubscribed_at, source) with **double opt-in**.
- `newsletter-subscribe` public function + a capture form on the bio page.
- `generate-newsletter` on a daily cron, composing from that day's `trend_source` rows, sent via Resend/Postmark.
- Affiliate links go through the same `short_links`/`redirect` stack, so email and social revenue land in one attribution model rather than two.
- **Compliance isn't optional**: unsubscribe link and a physical mailing address in every issue (CAN-SPAM), and honor `unsubscribed_at` on send.

The strategic argument: an email list is the only audience asset here not
rented from a platform that can change its rules without warning.

### Step 5 — Media kit + sponsorship tracking

`sponsorships` table (sponsor_name, rate, status, slot dates, deliverables),
sponsored posts as queue slots that outrank auto-generated ones, and a public
media-kit page built from the `platform_metrics` already syncing. Per-unit
revenue is orders of magnitude above affiliate clicks, but it's gated on
audience size — build it when there's reach to sell.

### Step 6 — Productize (highest ceiling, longest lead time)

The schema is already multi-tenant. Missing: Stripe subscriptions,
entitlement gating, a signup flow, per-user platform credentials, and —
critically — **per-user cost metering**. A Seedance video runs 10-20x an
image, so an unmetered subscriber can be net-negative. Meter before selling.

**The real blocker is review latency, not code**: connecting *other people's*
accounts needs full Meta App Review and TikTok's Content Posting audit —
exactly what Phase 4 sidestepped by only ever connecting the developer's own
account, and what Phase 8 is still waiting on. The compensating asset is that
this repo's accumulated integration knowledge (NOTES.md) is what competitors
burn weeks rediscovering.
