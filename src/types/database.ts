// Hand-written to match supabase/migrations/0001_init.sql.
// Regenerate with `supabase gen types typescript` once the project is linked,
// then this file becomes generated output instead of hand-maintained.
//
// NOTE: these must be `type` object literals, not `interface`s -- Supabase's
// generic table constraint requires structural assignability to
// `Record<string, unknown>`, and TypeScript only grants that to type
// literals (interfaces are treated as open/augmentable and rejected).

export type Platform = 'instagram' | 'tiktok' | 'pinterest' | 'x' | 'facebook' | 'other'
export type Accent = 'coral' | 'yellow' | 'blue'
export type ConnectionStatus = 'manual' | 'pending' | 'connected' | 'error'
export type PostStatus = 'draft' | 'ready' | 'generating' | 'scheduled' | 'published' | 'failed'
export type PostSource = 'manual' | 'auto'
export type MediaType = 'image' | 'video'

export type TrendSource = {
  url: string
  summary: string
}

export type SocialProfileRow = {
  id: string
  user_id: string
  platform: Platform
  display_name: string
  handle: string
  tone: string | null
  accent: Accent
  follower_count: number | null
  connection_status: ConnectionStatus
  external_id: string | null
  created_at: string
  updated_at: string
}
export type SocialProfileInsert = {
  platform: Platform
  display_name: string
  handle: string
  tone?: string | null
  accent?: Accent
  follower_count?: number | null
  connection_status?: ConnectionStatus
}
export type SocialProfileUpdate = Partial<SocialProfileInsert>

export type PostRow = {
  id: string
  user_id: string
  social_profile_id: string | null
  title: string
  body: string | null
  tag: string | null
  status: PostStatus
  source: PostSource
  trend_source: TrendSource | null
  media_url: string | null
  media_type: MediaType
  video_job_id: string | null
  video_prompt: string | null
  platform_media_id: string | null
  failure_reason: string | null
  publish_attempts: number
  scheduled_for: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}
export type PostInsert = {
  title: string
  social_profile_id?: string | null
  body?: string | null
  tag?: string | null
  status?: PostStatus
  source?: PostSource
  media_url?: string | null
  media_type?: MediaType
  video_job_id?: string | null
  video_prompt?: string | null
  platform_media_id?: string | null
  failure_reason?: string | null
  trend_source?: TrendSource | null
  scheduled_for?: string | null
  published_at?: string | null
}
export type PostUpdate = Partial<PostInsert>

export type ShortLinkRow = {
  id: string
  user_id: string
  post_id: string | null
  affiliate_offer_id: string | null
  slug: string
  destination_url: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  created_at: string
}
export type ShortLinkInsert = {
  slug: string
  destination_url: string
  post_id?: string | null
  affiliate_offer_id?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
}

export type LinkClickRow = {
  id: string
  short_link_id: string
  clicked_at: string
  referrer: string | null
  user_agent: string | null
  ip_hash: string | null
  country: string | null
}

export type RevenueEventStatus = 'pending' | 'confirmed' | 'reversed'

export type RevenueEventRow = {
  id: string
  user_id: string
  short_link_id: string | null
  post_id: string | null
  source: string
  amount: number
  currency: string
  occurred_at: string
  status: RevenueEventStatus
  external_ref: string | null
  note: string | null
  created_at: string
}
export type RevenueEventInsert = {
  source: string
  amount: number
  occurred_at: string
  currency?: string
  short_link_id?: string | null
  post_id?: string | null
  status?: RevenueEventStatus
  external_ref?: string | null
  note?: string | null
}
export type RevenueEventUpdate = Partial<RevenueEventInsert>

// affiliate_offers: what the generation functions attach to every post they
// create (Phase 12 Step 1). destination_url is deliberately anything --
// an affiliate tracking link, a product page, or your own newsletter signup.
export type AffiliateOfferRow = {
  id: string
  user_id: string
  program_name: string
  destination_url: string
  keywords: string[]
  category: string | null
  priority: number
  active: boolean
  // Appended to the caption wherever this offer's link appears. Required for
  // affiliate links; null for destinations you own.
  disclosure: string | null
  created_at: string
  updated_at: string
}
export type AffiliateOfferInsert = {
  program_name: string
  destination_url: string
  keywords?: string[]
  category?: string | null
  priority?: number
  active?: boolean
  disclosure?: string | null
}
export type AffiliateOfferUpdate = Partial<AffiliateOfferInsert>

export type AutomationSettingsRow = {
  user_id: string
  niche_description: string | null
  brand_voice: string | null
  topic_blocklist: string[]
  daily_auto_post_cap: number
  daily_reel_cap: number
  auto_posting_enabled: boolean
  // X bills 13x for a post containing a URL, so inline X links are opt-in.
  x_inline_links_enabled: boolean
  // Link-in-bio page (Phase 12 Step 2). A null bio_slug means the public
  // page is off.
  bio_slug: string | null
  bio_headline: string | null
  bio_subhead: string | null
  bio_avatar_url: string | null
  bio_handle: string | null
  updated_at: string
}
export type AutomationSettingsUpdate = Partial<
  Omit<AutomationSettingsRow, 'user_id' | 'updated_at'>
>

// platform_metrics is written only by sync-instagram-insights
// (service_role) -- the frontend only ever selects from it.
export type PlatformMetricRow = {
  id: string
  user_id: string
  social_profile_id: string
  post_id: string | null
  metric_scope: string
  metric_name: string
  metric_value: number
  metric_date: string
  updated_at: string
}

export type Database = {
  public: {
    Tables: {
      social_profiles: {
        Row: SocialProfileRow
        Insert: SocialProfileInsert
        Update: SocialProfileUpdate
        Relationships: []
      }
      posts: {
        Row: PostRow
        Insert: PostInsert
        Update: PostUpdate
        Relationships: []
      }
      short_links: {
        Row: ShortLinkRow
        Insert: ShortLinkInsert
        Update: Partial<ShortLinkInsert>
        Relationships: []
      }
      link_clicks: {
        Row: LinkClickRow
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      revenue_events: {
        Row: RevenueEventRow
        Insert: RevenueEventInsert
        Update: RevenueEventUpdate
        Relationships: []
      }
      automation_settings: {
        Row: AutomationSettingsRow
        Insert: AutomationSettingsUpdate & { user_id?: string }
        Update: AutomationSettingsUpdate
        Relationships: []
      }
      platform_metrics: {
        Row: PlatformMetricRow
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      affiliate_offers: {
        Row: AffiliateOfferRow
        Insert: AffiliateOfferInsert
        Update: AffiliateOfferUpdate
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
