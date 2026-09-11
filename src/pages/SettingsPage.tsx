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

  useEffect(() => {
    if (!settings) return
    setNiche(settings.niche_description ?? '')
    setBrandVoice(settings.brand_voice ?? '')
    setBlocklist(settings.topic_blocklist.join(', '))
    setDailyCap(settings.daily_auto_post_cap)
    setDailyReelCap(settings.daily_reel_cap)
    setEnabled(settings.auto_posting_enabled)
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
    })
  }

  if (isLoading) return <p className="empty-state">Loading…</p>

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Automation</span>
          <h1>Settings</h1>
          <p>Controls the trend-based auto-drafting job. Off by default.</p>
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
