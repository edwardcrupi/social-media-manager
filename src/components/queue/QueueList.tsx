import type { PostRow, SocialProfileRow } from '../../types/database'
import { useDeletePost, useUpdatePost } from '../../hooks/usePosts'
import { QueueItem } from './QueueItem'

export function QueueList({ posts, profiles }: { posts: PostRow[]; profiles: SocialProfileRow[] }) {
  const updatePost = useUpdatePost()
  const deletePost = useDeletePost()

  if (posts.length === 0) {
    return <p className="empty-state">Nothing in the queue yet — create your first post.</p>
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))

  return (
    <div className="queue-list">
      {posts.map((post, index) => (
        <QueueItem
          key={post.id}
          post={post}
          index={index}
          profile={post.social_profile_id ? profileById.get(post.social_profile_id) : undefined}
          onStatusChange={(item, status) => updatePost.mutate({ id: item.id, update: { status } })}
          onDelete={(item) => deletePost.mutate(item.id)}
        />
      ))}
    </div>
  )
}
