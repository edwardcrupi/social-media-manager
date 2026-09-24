import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAutomationSettings, useSaveAutomationSettings } from '../hooks/useAutomationSettings'

export function SettingsPage() {
  const { data: settings, isLoading } = useAutomationSettings()
  const saveSettings = useSaveAutomationSettings()

  const [niche, setNiche] = useState('')
  const [brandVoice, setBrandVoice] = useState('')
  const [blocklist, setBlocklist] = useState('')
  const [dailyCap, setDailyCap] = useState(2)
  const [dailyReelCap, setDailyReelCap] = useState(1)
  const [enabled, setEnabled] = useState(false)
  const [xInlineLinks, setXInlineLinks] = useState(false)
  const [bioSlug, setBioSlug] = useState('')
  const [bioHeadline, setBioHeadline] = useState('')
  const [bioSubhead, setBioSubhead] = useState('')
  const [bioHandle, setBioHandle] = useState('')
  const [bioAvatarUrl, setBioAvatarUrl] = useState('')

  useEffect(() => {
    if (!settings) return
    setNiche(settings.niche_description ?? '')
    setBrandVoice(settings.brand_voice ?? '')
    setBlocklist(settings.topic_blocklist.join(', '))
    setDailyCap(settings.daily_auto_post_cap)
    setDailyReelCap(settings.daily_reel_cap)
    setEnabled(settings.auto_posting_enabled)
    setXInlineLinks(settings.x_inline_links_enabled)
    setBioSlug(settings.bio_slug ?? '')
    setBioHeadline(settings.bio_headline ?? '')
    setBioSubhead(settings.bio_subhead ?? '')
    setBioHandle(settings.bio_handle ?? '')
    setBioAvatarUrl(settings.bio_avatar_url ?? '')
  }, [settings])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    saveSettings.mutate({
      niche_description: niche.trim() || null,
      brand_voice: brandVoice.trim() || null,
      topic_blocklist: blocklist
        .split(',')
        .map((topic) => topic.trim())
        .filter(Boolean),
      daily_auto_post_cap: dailyCap,
      daily_reel_cap: dailyReelCap,
      auto_posting_enabled: enabled,
      x_inline_links_enabled: xInlineLinks,
      // Empty means "page off" -- it has to reach the column as null, not
      // an empty string, since bio_slug is unique and two users saving a
      // blank slug would collide.
      bio_slug: bioSlug.trim().toLowerCase() || null,
      bio_headline: bioHeadline.trim() || null,
      bio_subhead: bioSubhead.trim() || null,
      bio_handle: bioHandle.trim() || null,
      bio_avatar_url: bioAvatarUrl.trim() || null,
    })
  }

  if (isLoading) return <p className="empty-state">Loading…</p>

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Automation</span>
          <h1>Settings</h1>
          <p>Controls the trend-based auto-drafting job and the public link-in-bio page. Auto-posting is off by default.</p>
        </div>
      </div>

      <section className="panel">
        <form className="settings-form" onSubmit={handleSubmit}>
          <label>
            <span>Niche description</span>
            <input
              placeholder="e.g. sustainable home goods for young families"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
            />
          </label>
          <label>
            <span>Brand voice</span>
            <input
              placeholder="e.g. warm, a little irreverent, no corporate speak"
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
            />
          </label>
          <label>
            <span>Topic blocklist (comma-separated)</span>
            <input
              placeholder="e.g. politics, tragedy, layoffs"
              value={blocklist}
              onChange={(e) => setBlocklist(e.target.value)}
            />
          </label>
          <label>
            <span>Daily auto-post cap (images)</span>
            <input
              type="number"
              min={0}
              max={10}
              value={dailyCap}
              onChange={(e) => setDailyCap(Number(e.target.value))}
              style={{ maxWidth: 100 }}
            />
          </label>
          <label>
            <span>Daily reel cap (video — costs far more per post, keep this low)</span>
            <input
              type="number"
              min={0}
              max={5}
              value={dailyReelCap}
              onChange={(e) => setDailyReelCap(Number(e.target.value))}
              style={{ maxWidth: 100 }}
            />
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>Enable auto-posting (drafts are scheduled with no manual review)</span>
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={xInlineLinks} onChange={(e) => setXInlineLinks(e.target.checked)} />
            <span>
              Put tracked links in X captions (X bills $0.20 per post containing a URL vs $0.015 without — 13x)
            </span>
          </label>

          <label>
            <span>Bio page address (blank turns the public page off)</span>
            <input
              placeholder="e.g. aiuniverse"
              value={bioSlug}
              onChange={(e) => setBioSlug(e.target.value)}
            />
          </label>
          {bioSlug.trim() && (
            <p className="panel-note">
              Live at {import.meta.env.VITE_SUPABASE_URL}/functions/v1/bio/{bioSlug.trim().toLowerCase()} — this is what
              goes in the Instagram bio, since Instagram captions aren't clickable.
            </p>
          )}
          <label>
            <span>Bio page headline</span>
            <input value={bioHeadline} onChange={(e) => setBioHeadline(e.target.value)} />
          </label>
          <label>
            <span>Bio page subheading</span>
            <input value={bioSubhead} onChange={(e) => setBioSubhead(e.target.value)} />
          </label>
          <label>
            <span>Bio page handle</span>
            <input placeholder="@yourhandle" value={bioHandle} onChange={(e) => setBioHandle(e.target.value)} />
          </label>
          <label>
            <span>Bio page avatar URL</span>
            <input value={bioAvatarUrl} onChange={(e) => setBioAvatarUrl(e.target.value)} />
          </label>
          <button className="primary-button" type="submit" disabled={saveSettings.isPending}>
            {saveSettings.isPending ? 'Saving…' : 'Save settings'}
          </button>
          {saveSettings.isSuccess && <p className="login-sent">Settings saved.</p>}
          {saveSettings.isError && (
            <p className="login-error">
              {saveSettings.error instanceof Error ? saveSettings.error.message : 'Failed to save settings.'}
            </p>
          )}
        </form>
      </section>
    </>
  )
}
