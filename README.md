# Social Media Manager

Tracks revenue attributed to social media activity via affiliate/UTM short links, with content-queue management for Instagram/TikTok (manual today, OAuth-connected once app review clears).

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

**Note**: posts it creates land in your content queue with `status: scheduled` -- they don't reach Instagram/TikTok on their own yet. Actual auto-publishing depends on the OAuth integration work in the roadmap (Phases 4-5 of the plan).

## Scripts

- `npm run dev` -- start the dev server
- `npm run build` -- type-check and build for production
- `npm run lint` -- run oxlint
- `npm run preview` -- preview the production build locally
