import type { PostRow, PostStatus, SocialProfileRow } from '../../types/database'
import { VideoThumb } from './VideoThumb'

const dateColors = ['coral', 'yellow', 'blue']
const STATUSES: PostStatus[] = ['draft', 'ready', 'generating', 'scheduled', 'published', 'failed']

const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

function platformLabel(profile: SocialProfileRow | undefined) {
  if (!profile) return 'Unassigned'
  return `${profile.platform.charAt(0).toUpperCase()}${profile.platform.slice(1)}`
}

// `posts` is every row sharing one piece of media -- the per-platform fan-out
// of a single generated idea, or just one row for a manual post. The idea's
// thumbnail, title and body render once; status and delete stay per platform.
export function QueueItem({
  posts,
  index,
  profileById,
  onStatusChange,
  onDelete,
}: {
  posts: PostRow[]
  index: number
  profileById: Map<string, SocialProfileRow>
  onStatusChange: (post: PostRow, status: PostStatus) => void
  onDelete: (post: PostRow) => void
}) {
  const [post] = posts
  const scheduled = post.scheduled_for ? new Date(post.scheduled_for) : null

  return (
    <div className="queue-item">
      <span className={`queue-date ${dateColors[index % dateColors.length]}`}>
        <b>{scheduled ? dayFormatter.format(scheduled) : 'Unscheduled'}</b>
        <small>{scheduled ? timeFormatter.format(scheduled) : '—'}</small>
      </span>
      {post.media_url && post.media_type === 'video' && (
        <VideoThumb postId={post.id} mediaUrl={post.media_url} posterUrl={post.poster_url} />
      )}
      {post.media_url && post.media_type === 'image' && (
        <img className="queue-thumb" src={post.media_url} alt="" loading="lazy" />
      )}
      {!post.media_url && post.status === 'generating' && <span className="queue-thumb queue-thumb-pending">⏳</span>}
      {!post.media_url && post.status === 'failed' && <span className="queue-thumb queue-thumb-pending">✕</span>}
      <div className="queue-title">
        <strong>{post.title}</strong>
        <span>
          {post.tag ?? 'Untagged'}
          {post.media_type === 'video' && ' · Reel'}
          {post.source === 'auto' && ' · Auto'}
          {posts.length > 1 && ` · ${posts.length} platforms`}
        </span>
        {posts.map(
          (item) =>
            item.status === 'failed' &&
            item.failure_reason && (
              <p key={item.id} className="queue-body login-error">
                {platformLabel(item.social_profile_id ? profileById.get(item.social_profile_id) : undefined)} failed:{' '}
                {item.failure_reason}
              </p>
            ),
        )}
        {post.body && <p className="queue-body">{post.body}</p>}
        {post.trend_source && (
          <a className="queue-source-link" href={post.trend_source.url} target="_blank" rel="noreferrer">
            Source: {post.trend_source.summary || post.trend_source.url}
          </a>
        )}
      </div>
      <div className="queue-platforms">
        {posts.map((item) => {
          const profile = item.social_profile_id ? profileById.get(item.social_profile_id) : undefined
          return (
            <div className="queue-platform" key={item.id}>
              <span className="queue-platform-name">{platformLabel(profile)}</span>
              <select
                className={`status ${item.status === 'draft' || item.status === 'generating' || item.status === 'failed' ? 'draft' : 'ready'}`}
                value={item.status}
                onChange={(event) => onStatusChange(item, event.target.value as PostStatus)}
                aria-label={`${platformLabel(profile)} post status`}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <button
                className="more-button"
                onClick={() => onDelete(item)}
                aria-label={`Delete ${platformLabel(profile)} post`}
              >
                x
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
