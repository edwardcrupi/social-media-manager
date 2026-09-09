import { useState } from 'react'
import type { FormEvent } from 'react'
import { useSocialProfiles, useCreateSocialProfile, useDeleteSocialProfile } from '../hooks/useSocialProfiles'
import type { Accent, Platform } from '../types/database'

const PLATFORMS: Platform[] = ['instagram', 'tiktok', 'pinterest', 'other']
const ACCENTS: Accent[] = ['coral', 'yellow', 'blue']

export function ProfilesPage() {
  const { data: profiles, isLoading } = useSocialProfiles()
  const createProfile = useCreateSocialProfile()
  const deleteProfile = useDeleteSocialProfile()

  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [accent, setAccent] = useState<Accent>('coral')
  const [followerCount, setFollowerCount] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!displayName.trim() || !handle.trim()) return
    createProfile.mutate({
      display_name: displayName.trim(),
      handle: handle.trim(),
      platform,
      accent,
      tone: null,
      follower_count: followerCount ? Number(followerCount) : null,
    })
    setDisplayName('')
    setHandle('')
    setFollowerCount('')
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Accounts</span>
          <h1>Profiles</h1>
          <p>Manual accounts today — OAuth connections land once Instagram/TikTok app review clears.</p>
        </div>
      </div>

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
          <button className="primary-button" type="submit">
            Add profile
          </button>
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
