import type { PostRow } from '../../types/database'
import { useDeletePost, useUpdatePost } from '../../hooks/usePosts'
import { QueueItem } from './QueueItem'

export function QueueList({ posts }: { posts: PostRow[] }) {
  const updatePost = useUpdatePost()
  const deletePost = useDeletePost()

  if (posts.length === 0) {
    return <p className="empty-state">Nothing in the queue yet — create your first post.</p>
  }

  return (
    <div className="queue-list">
      {posts.map((post, index) => (
        <QueueItem
          key={post.id}
          post={post}
          index={index}
          onStatusChange={(item, status) => updatePost.mutate({ id: item.id, update: { status } })}
          onDelete={(item) => deletePost.mutate(item.id)}
        />
      ))}
    </div>
  )
}
