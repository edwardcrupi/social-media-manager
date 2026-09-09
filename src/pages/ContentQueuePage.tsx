import { useState } from 'react'
import type { FormEvent } from 'react'
import { usePosts, useCreatePost } from '../hooks/usePosts'
import { useSocialProfiles } from '../hooks/useSocialProfiles'
import { QueueList } from '../components/queue/QueueList'

export function ContentQueuePage() {
  const { data: posts, isLoading } = usePosts()
  const { data: profiles } = useSocialProfiles()
  const createPost = useCreatePost()

  const [title, setTitle] = useState('')
  const [tag, setTag] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [profileId, setProfileId] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    createPost.mutate(
      {
        title: title.trim(),
        tag: tag.trim() || null,
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        social_profile_id: profileId || null,
        body: null,
      },
      {
        onSuccess: () => {
          setTitle('')
          setTag('')
          setScheduledFor('')
          setProfileId('')
        },
      },
    )
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Content</span>
          <h1>Content queue</h1>
          <p>Everything drafted, scheduled, or published.</p>
        </div>
      </div>

      <section className="panel queue-panel">
        <form className="composer" onSubmit={handleSubmit}>
          <input placeholder="Post title or hook" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input placeholder="Tag" value={tag} onChange={(e) => setTag(e.target.value)} style={{ maxWidth: 140 }} />
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            style={{ maxWidth: 200 }}
          />
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">No profile</option>
            {(profiles ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.display_name}
              </option>
            ))}
          </select>
          <button className="primary-button" type="submit" disabled={createPost.isPending}>
            {createPost.isPending ? 'Adding…' : 'Add to queue'}
          </button>
          {createPost.isError && (
            <p className="login-error">
              {createPost.error instanceof Error ? createPost.error.message : 'Failed to add post.'}
            </p>
          )}
        </form>
      </section>

      <section className="panel queue-panel">
        {isLoading ? <p className="empty-state">Loading…</p> : <QueueList posts={posts ?? []} />}
      </section>
    </>
  )
}
