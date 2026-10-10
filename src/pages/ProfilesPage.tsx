import { useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSocialProfiles, useCreateSocialProfile, useDeleteSocialProfile } from '../hooks/useSocialProfiles'
import type { Accent, Platform } from '../types/database'
import { supabase } from '../lib/supabase'

const PLATFORMS: Platform[] = ['instagram', 'tiktok', 'x', 'facebook', 'pinterest', 'other']
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
  const [connectingInstagram, setConnectingInstagram] = useState(false)
  const [connectingTiktok, setConnectingTiktok] = useState(false)
  const [connectingX, setConnectingX] = useState(false)
  const [connectingFacebook, setConnectingFacebook] = useState(false)

  const igConnected = searchParams.get('ig_connected')
  const igError = searchParams.get('ig_error')
  const ttConnected = searchParams.get('tt_connected')
  const ttError = searchParams.get('tt_error')
  const xConnected = searchParams.get('x_connected')
  const xError = searchParams.get('x_error')
  const fbConnected = searchParams.get('fb_connected')
  const fbError = searchParams.get('fb_error')

  async function handleConnectInstagram() {
    setConnectingInstagram(true)
    setConnectError('')
    const { data, error } = await supabase.functions.invoke<{ url: string }>('instagram-oauth-start')
    if (error || !data?.url) {
      setConnectError(error?.message ?? 'Failed to start Instagram connection.')
      setConnectingInstagram(false)
      return
    }
    window.location.href = data.url
  }

  async function handleConnectTiktok() {
    setConnectingTiktok(true)
    setConnectError('')
    const { data, error } = await supabase.functions.invoke<{ url: string }>('tiktok-oauth-start')
    if (error || !data?.url) {
      setConnectError(error?.message ?? 'Failed to start TikTok connection.')
      setConnectingTiktok(false)
      return
    }
    window.location.href = data.url
  }

  async function handleConnectX() {
    setConnectingX(true)
    setConnectError('')
    const { data, error } = await supabase.functions.invoke<{ url: string }>('x-oauth-start')
    if (error || !data?.url) {
      setConnectError(error?.message ?? 'Failed to start X connection.')
      setConnectingX(false)
      return
    }
    window.location.href = data.url
  }

  async function handleConnectFacebook() {
    setConnectingFacebook(true)
    setConnectError('')
    const { data, error } = await supabase.functions.invoke<{ url: string }>('facebook-oauth-start')
    if (error || !data?.url) {
      setConnectError(error?.message ?? 'Failed to start Facebook connection.')
      setConnectingFacebook(false)
      return
    }
    window.location.href = data.url
  }

  function dismissBanner() {
    const next = new URLSearchParams(searchParams)
    next.delete('ig_connected')
    next.delete('ig_error')
    next.delete('tt_connected')
    next.delete('tt_error')
    next.delete('x_connected')
    next.delete('x_error')
    next.delete('fb_connected')
    next.delete('fb_error')
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
          <p>Add accounts manually, or connect Instagram/TikTok/X/Facebook directly for live follower counts.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="primary-button" onClick={handleConnectInstagram} disabled={connectingInstagram}>
            {connectingInstagram ? 'Connecting…' : 'Connect Instagram'}
          </button>
          <button className="primary-button" onClick={handleConnectTiktok} disabled={connectingTiktok}>
            {connectingTiktok ? 'Connecting…' : 'Connect TikTok'}
          </button>
          <button className="primary-button" onClick={handleConnectX} disabled={connectingX}>
            {connectingX ? 'Connecting…' : 'Connect X'}
          </button>
          <button className="primary-button" onClick={handleConnectFacebook} disabled={connectingFacebook}>
            {connectingFacebook ? 'Connecting…' : 'Connect Facebook'}
          </button>
        </div>
      </div>

      {(igConnected || ttConnected || xConnected || fbConnected) && (
        <p className="login-sent" onClick={dismissBanner} style={{ cursor: 'pointer' }}>
          {igConnected ? 'Instagram' : ttConnected ? 'TikTok' : xConnected ? 'X' : 'Facebook'} connected. (click to dismiss)
        </p>
      )}
      {(igError || ttError || xError || fbError || connectError) && (
        <p className="login-error" onClick={dismissBanner} style={{ cursor: 'pointer' }}>
          {igError || ttError || xError || fbError || connectError} (click to dismiss)
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

      {deleteProfile.isError && (
        <p className="login-error" onClick={() => deleteProfile.reset()} style={{ cursor: 'pointer' }}>
          {deleteProfile.error instanceof Error ? deleteProfile.error.message : 'Failed to remove profile.'} (click to
          dismiss)
        </p>
      )}

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
