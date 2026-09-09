import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../providers/AuthProvider'
import { usePosts, useCreatePost } from '../hooks/usePosts'
import { useRevenueEvents } from '../hooks/useRevenueEvents'
import { useSocialProfiles } from '../hooks/useSocialProfiles'
import { MetricCard } from '../components/metrics/MetricCard'
import { RevenueChart } from '../components/chart/RevenueChart'
import { QueueList } from '../components/queue/QueueList'
import { ProfileCard } from '../components/profiles/ProfileCard'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function OverviewPage() {
  const { user } = useAuth()
  const { data: posts } = usePosts()
  const { data: revenueEvents } = useRevenueEvents()
  const { data: profiles } = useSocialProfiles()
  const createPost = useCreatePost()

  const [showComposer, setShowComposer] = useState(false)
  const [draft, setDraft] = useState('')

  const totalRevenue = (revenueEvents ?? []).reduce((sum, event) => sum + Number(event.amount), 0)
  const queuedPosts = (posts ?? []).filter((post) => post.status !== 'published')
  const activeProfile = profiles?.[0]
  const profilePostCount = activeProfile
    ? (posts ?? []).filter((post) => post.social_profile_id === activeProfile.id).length
    : 0

  function handleComposerSubmit(event: FormEvent) {
    event.preventDefault()
    if (!draft.trim()) return
    createPost.mutate(
      { title: draft.trim() },
      {
        onSuccess: () => {
          setDraft('')
          setShowComposer(false)
        },
      },
    )
  }

  const firstName = user?.email?.split('@')[0] ?? 'there'

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(
              new Date(),
            )}
          </span>
          <h1>Good morning, {firstName}.</h1>
          <p>Here is how your social business is performing.</p>
        </div>
        <button className="primary-button" onClick={() => setShowComposer(!showComposer)}>
          <span>+</span> Create content
        </button>
      </div>

      <section className="metric-grid" aria-label="Business metrics">
        <MetricCard label="Attributed revenue" value={currency.format(totalRevenue)} icon="$" caption="All time" dark />
        <MetricCard label="Posts in queue" value={String(queuedPosts.length)} icon="+" caption="Draft, ready, or scheduled" />
        <MetricCard label="Connected profiles" value={String(profiles?.length ?? 0)} icon="%" caption="Across all platforms" />
      </section>

      <section className="content-grid">
        <article className="panel performance-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Performance</span>
              <h2>Revenue by source</h2>
            </div>
          </div>
          <RevenueChart events={revenueEvents ?? []} />
        </article>
        {activeProfile ? (
          <ProfileCard profile={activeProfile} postCount={profilePostCount} />
        ) : (
          <article className="panel profile-panel">
            <p className="empty-state">No profiles yet. Add one on the Profiles page.</p>
          </article>
        )}
      </section>

      <section className="panel queue-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Up next</span>
            <h2>Content queue</h2>
          </div>
        </div>
        <QueueList posts={queuedPosts.slice(0, 5)} />
      </section>

      {showComposer && (
        <form className="composer" onSubmit={handleComposerSubmit}>
          <div>
            <span className="eyebrow">Quick draft</span>
            <h2>What are you publishing next?</h2>
          </div>
          <input
            autoFocus
            placeholder="Write a hook or paste a content idea..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="primary-button" type="submit" disabled={createPost.isPending}>
            {createPost.isPending ? 'Saving…' : 'Save draft'}
          </button>
          {createPost.isError && (
            <p className="login-error">
              {createPost.error instanceof Error ? createPost.error.message : 'Failed to save draft.'}
            </p>
          )}
        </form>
      )}
    </>
  )
}
