import type { SocialProfileRow } from '../../types/database'

export function ProfileCard({ profile, postCount }: { profile: SocialProfileRow; postCount: number }) {
  return (
    <article className="panel profile-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Active profile</span>
          <h2>{profile.display_name}</h2>
        </div>
      </div>
      <div className="profile-hero">
        <div className={`profile-avatar ${profile.accent}`}>{profile.display_name[0]}</div>
        <div>
          <strong>{profile.handle}</strong>
          <span>
            {profile.platform}
            {profile.tone ? ` / ${profile.tone}` : ''}
          </span>
        </div>
        <span className="live-dot">{profile.connection_status}</span>
      </div>
      <div className="profile-stats">
        <div>
          <strong>{profile.follower_count ?? '—'}</strong>
          <span>Followers</span>
        </div>
        <div>
          <strong>{postCount}</strong>
          <span>Posts</span>
        </div>
      </div>
      {profile.connection_status === 'manual' && (
        <div className="profile-note">
          <span>i</span>
          <p>
            <strong>Manual profile</strong> Real engagement and reach data will appear here once this account is
            connected via OAuth (Instagram/TikTok integration is on the roadmap).
          </p>
        </div>
      )}
    </article>
  )
}
