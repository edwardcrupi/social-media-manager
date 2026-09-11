import type { PostRow, PostStatus } from '../../types/database'

const dateColors = ['coral', 'yellow', 'blue']
const STATUSES: PostStatus[] = ['draft', 'ready', 'generating', 'scheduled', 'published']

const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

export function QueueItem({
  post,
  index,
  onStatusChange,
  onDelete,
}: {
  post: PostRow
  index: number
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
        // A bare <video> often renders blank until played; the #t= media
        // fragment hints the browser to seek there and paint that frame,
        // giving a poster-like preview without a separate thumbnail asset.
        <video className="queue-thumb" src={`${post.media_url}#t=0.5`} muted playsInline preload="metadata" />
      )}
      {post.media_url && post.media_type === 'image' && <img className="queue-thumb" src={post.media_url} alt="" />}
      {!post.media_url && post.status === 'generating' && <span className="queue-thumb queue-thumb-pending">⏳</span>}
      <div className="queue-title">
        <strong>{post.title}</strong>
        <span>
          {post.tag ?? 'Untagged'}
          {post.media_type === 'video' && ' · Reel'}
          {post.source === 'auto' && ' · Auto'}
        </span>
        {post.body && <p className="queue-body">{post.body}</p>}
        {post.trend_source && (
          <a className="queue-source-link" href={post.trend_source.url} target="_blank" rel="noreferrer">
            Source: {post.trend_source.summary || post.trend_source.url}
          </a>
        )}
      </div>
      <select
        className={`status ${post.status === 'draft' || post.status === 'generating' ? 'draft' : 'ready'}`}
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
