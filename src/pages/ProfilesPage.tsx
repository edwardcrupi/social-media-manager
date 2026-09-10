import { useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSocialProfiles, useCreateSocialProfile, useDeleteSocialProfile } from '../hooks/useSocialProfiles'
import type { Accent, Platform } from '../types/database'
import { supabase } from '../lib/supabase'

const PLATFORMS: Platform[] = ['instagram', 'tiktok', 'pinterest', 'other']
const ACCENTS: Accent[] = ['coral', 'yellow', 'blue']

export function ProfilesPage() {
  const { data: profiles, isLoading } = useSocialProfiles()
  const createProfile = useCreateSocialProfile()
  const deleteProfile = useDeleteSocialProfile()
  const [searchParams, setSearchParams] = useSearchParams()

  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [accent, setAccent] = useState<Accent>('coral')
  const [followerCount, setFollowerCount] = useState('')
  const [connectError, setConnectError] = useState('')
  const [connecting, setConnecting] = useState(false)

  const igConnected = searchParams.get('ig_connected')
  const igError = searchParams.get('ig_error')

  async function handleConnectInstagram() {
    setConnecting(true)
    setConnectError('')
    const { data, error } = await supabase.functions.invoke<{ url: string }>('instagram-oauth-start')
    if (error || !data?.url) {
      setConnectError(error?.message ?? 'Failed to start Instagram connection.')
      setConnecting(false)
      return
    }
    window.location.href = data.url
  }

  function dismissBanner() {
    const next = new URLSearchParams(searchParams)
    next.delete('ig_connected')
    next.delete('ig_error')
    setSearchParams(next, { replace: true })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!displayName.trim() || !handle.trim()) return
    createProfile.mutate(
      {
        display_name: displayName.trim(),
        handle: handle.trim(),
        platform,
        accent,
        tone: null,
        follower_count: followerCount ? Number(followerCount) : null,
      },
      {
        onSuccess: () => {
          setDisplayName('')
          setHandle('')
          setFollowerCount('')
        },
      },
    )
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Accounts</span>
          <h1>Profiles</h1>
          <p>Add accounts manually, or connect Instagram directly for live follower counts.</p>
        </div>
        <button className="primary-button" onClick={handleConnectInstagram} disabled={connecting}>
          {connecting ? 'Connecting…' : 'Connect Instagram'}
        </button>
      </div>

      {igConnected && (
        <p className="login-sent" onClick={dismissBanner} style={{ cursor: 'pointer' }}>
          Instagram connected. (click to dismiss)
        </p>
      )}
      {(igError || connectError) && (
        <p className="login-error" onClick={dismissBanner} style={{ cursor: 'pointer' }}>
          {igError || connectError} (click to dismiss)
        </p>
      )}

      <section className="panel">
        <form className="composer" onSubmit={handleSubmit}>
          <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <input placeholder="@handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select value={accent} onChange={(e) => setAccent(e.target.value as Accent)}>
            {ACCENTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            placeholder="Followers"
            type="number"
            value={followerCount}
            onChange={(e) => setFollowerCount(e.target.value)}
            style={{ maxWidth: 120 }}
          />
          <button className="primary-button" type="submit" disabled={createProfile.isPending}>
            {createProfile.isPending ? 'Adding…' : 'Add profile'}
          </button>
          {createProfile.isError && (
            <p className="login-error">
              {createProfile.error instanceof Error ? createProfile.error.message : 'Failed to add profile.'}
            </p>
          )}
        </form>
      </section>

      <section className="content-grid">
        {isLoading && <p className="empty-state">Loading…</p>}
        {profiles?.length === 0 && <p className="empty-state">No profiles yet.</p>}
        {profiles?.map((profile) => (
          <article key={profile.id} className="panel profile-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">{profile.platform}</span>
                <h2>{profile.display_name}</h2>
              </div>
              <button className="more-button" onClick={() => deleteProfile.mutate(profile.id)}>
                Remove
              </button>
            </div>
            <div className="profile-hero">
              <div className={`profile-avatar ${profile.accent}`}>{profile.display_name[0]}</div>
              <div>
                <strong>{profile.handle}</strong>
                <span>{profile.connection_status}</span>
              </div>
            </div>
            <div className="profile-stats">
              <div>
                <strong>{profile.follower_count ?? '—'}</strong>
                <span>Followers</span>
              </div>
            </div>
          </article>
        ))}
      </section>
    </>
  )
}
