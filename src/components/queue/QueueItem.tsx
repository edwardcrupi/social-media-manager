import type { PostRow, PostStatus, SocialProfileRow } from '../../types/database'

const dateColors = ['coral', 'yellow', 'blue']
const STATUSES: PostStatus[] = ['draft', 'ready', 'generating', 'scheduled', 'published', 'failed']

const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

export function QueueItem({
  post,
  index,
  profile,
  onStatusChange,
  onDelete,
}: {
  post: PostRow
  index: number
  profile: SocialProfileRow | undefined
  onStatusChange: (post: PostRow, status: PostStatus) => void
  onDelete: (post: PostRow) => void
}) {
  const scheduled = post.scheduled_for ? new Date(post.scheduled_for) : null

  return (
    <div className="queue-item">
      <span className={`queue-date ${dateColors[index % dateColors.length]}`}>
        <b>{scheduled ? dayFormatter.format(scheduled) : 'Unscheduled'}</b>
        <small>{scheduled ? timeFormatter.format(scheduled) : '—'}</small>
      </span>
      {post.media_url && post.media_type === 'video' && (
        <span className="queue-thumb-wrap">
          {/* A bare <video> often renders blank until played; the #t= media
              fragment hints the browser to seek there and paint that frame,
              giving a poster-like preview without a separate thumbnail asset. */}
          <video className="queue-thumb" src={`${post.media_url}#t=0.5`} muted playsInline preload="metadata" />
          <span className="queue-thumb-play" aria-hidden="true">
            ▶
          </span>
        </span>
      )}
      {post.media_url && post.media_type === 'image' && <img className="queue-thumb" src={post.media_url} alt="" />}
      {!post.media_url && post.status === 'generating' && <span className="queue-thumb queue-thumb-pending">⏳</span>}
      {!post.media_url && post.status === 'failed' && <span className="queue-thumb queue-thumb-pending">✕</span>}
      <div className="queue-title">
        <strong>{post.title}</strong>
        <span>
          {profile ? `${profile.platform.charAt(0).toUpperCase()}${profile.platform.slice(1)}` : 'Unassigned'}
          {' · '}
          {post.tag ?? 'Untagged'}
          {post.media_type === 'video' && ' · Reel'}
          {post.source === 'auto' && ' · Auto'}
        </span>
        {post.status === 'failed' && post.failure_reason && (
          <p className="queue-body login-error">Generation failed: {post.failure_reason}</p>
        )}
        {post.body && <p className="queue-body">{post.body}</p>}
        {post.trend_source && (
          <a className="queue-source-link" href={post.trend_source.url} target="_blank" rel="noreferrer">
            Source: {post.trend_source.summary || post.trend_source.url}
          </a>
        )}
      </div>
      <select
        className={`status ${post.status === 'draft' || post.status === 'generating' || post.status === 'failed' ? 'draft' : 'ready'}`}
        value={post.status}
        onChange={(event) => onStatusChange(post, event.target.value as PostStatus)}
        aria-label="Post status"
      >
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <button className="more-button" onClick={() => onDelete(post)} aria-label="Delete post">
        x
      </button>
    </div>
  )
}
