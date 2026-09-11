// Hand-written to match supabase/migrations/0001_init.sql.
// Regenerate with `supabase gen types typescript` once the project is linked,
// then this file becomes generated output instead of hand-maintained.
//
// NOTE: these must be `type` object literals, not `interface`s -- Supabase's
// generic table constraint requires structural assignability to
// `Record<string, unknown>`, and TypeScript only grants that to type
// literals (interfaces are treated as open/augmentable and rejected).

export type Platform = 'instagram' | 'tiktok' | 'pinterest' | 'other'
export type Accent = 'coral' | 'yellow' | 'blue'
export type ConnectionStatus = 'manual' | 'pending' | 'connected' | 'error'
export type PostStatus = 'draft' | 'ready' | 'generating' | 'scheduled' | 'published'
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
  trend_source?: TrendSource | null
  scheduled_for?: string | null
  published_at?: string | null
}
export type PostUpdate = Partial<PostInsert>

export type ShortLinkRow = {
  id: string
  user_id: string
  post_id: string | null
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

export type RevenueEventRow = {
  id: string
  user_id: string
  short_link_id: string | null
  post_id: string | null
  source: string
  amount: number
  currency: string
  occurred_at: string
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
  note?: string | null
}
export type RevenueEventUpdate = Partial<RevenueEventInsert>

export type AutomationSettingsRow = {
  user_id: string
  niche_description: string | null
  brand_voice: string | null
  topic_blocklist: string[]
  daily_auto_post_cap: number
  daily_reel_cap: number
  auto_posting_enabled: boolean
  updated_at: string
}
export type AutomationSettingsUpdate = Partial<
  Omit<AutomationSettingsRow, 'user_id' | 'updated_at'>
>

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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
