import type { PostRow, SocialProfileRow } from '../../types/database'
import { useDeletePost, useUpdatePost } from '../../hooks/usePosts'
import { QueueItem } from './QueueItem'

export function QueueList({ groups, profiles }: { groups: PostRow[][]; profiles: SocialProfileRow[] }) {
  const updatePost = useUpdatePost()
  const deletePost = useDeletePost()

  if (groups.length === 0) {
    return <p className="empty-state">Nothing in the queue yet — create your first post.</p>
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))

  return (
    <div className="queue-list">
      {groups.map((group, index) => (
        <QueueItem
          key={group[0].id}
          posts={group}
          index={index}
          profileById={profileById}
          onStatusChange={(item, status) => updatePost.mutate({ id: item.id, update: { status } })}
          onDelete={(item) => deletePost.mutate(item.id)}
        />
      ))}
    </div>
  )
}
