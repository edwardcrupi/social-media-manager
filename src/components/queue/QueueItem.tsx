import type { PostRow, PostStatus } from '../../types/database'

const dateColors = ['coral', 'yellow', 'blue']
const STATUS_CYCLE: PostStatus[] = ['draft', 'ready', 'scheduled', 'published']

const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

export function QueueItem({
  post,
  index,
  onCycleStatus,
  onDelete,
}: {
  post: PostRow
  index: number
  onCycleStatus: (post: PostRow) => void
  onDelete: (post: PostRow) => void
}) {
  const scheduled = post.scheduled_for ? new Date(post.scheduled_for) : null

  return (
    <div className="queue-item">
      <span className={`queue-date ${dateColors[index % dateColors.length]}`}>
        <b>{scheduled ? dayFormatter.format(scheduled) : 'Unscheduled'}</b>
        <small>{scheduled ? timeFormatter.format(scheduled) : '—'}</small>
      </span>
      <div className="queue-title">
        <strong>{post.title}</strong>
        <span>
          {post.tag ?? 'Untagged'}
          {post.source === 'auto' && ' · Auto'}
        </span>
        {post.body && <p className="queue-body">{post.body}</p>}
        {post.trend_source && (
          <a className="queue-source-link" href={post.trend_source.url} target="_blank" rel="noreferrer">
            Source: {post.trend_source.summary || post.trend_source.url}
          </a>
        )}
      </div>
      <button className={`status ${post.status === 'draft' ? 'draft' : 'ready'}`} onClick={() => onCycleStatus(post)}>
        <i />
        {post.status}
      </button>
      <button className="more-button" onClick={() => onDelete(post)} aria-label="Delete post">
        x
      </button>
    </div>
  )
}

export function nextStatus(status: PostStatus): PostStatus {
  const index = STATUS_CYCLE.indexOf(status)
  return STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length]
}
