import { usePosts } from '../hooks/usePosts'
import { useRevenueEvents } from '../hooks/useRevenueEvents'
import { usePlatformMetrics } from '../hooks/usePlatformMetrics'
import { MetricCard } from '../components/metrics/MetricCard'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const number = new Intl.NumberFormat('en-US')

const ACCOUNT_METRIC_LABELS: Record<string, string> = {
  reach: 'Reach',
  profile_views: 'Profile views',
  accounts_engaged: 'Accounts engaged',
  total_interactions: 'Total interactions',
}

// Metrics come in ordered by metric_date descending (see usePlatformMetrics),
// so the first row seen per (scope, name) is the most recent value.
function latestByName(metrics: { metric_name: string; metric_value: number; post_id: string | null }[], postId: string | null) {
  const latest = new Map<string, number>()
  for (const metric of metrics) {
    if (metric.post_id !== postId) continue
    if (!latest.has(metric.metric_name)) latest.set(metric.metric_name, metric.metric_value)
  }
  return latest
}

export function InsightsPage() {
  const { data: posts } = usePosts()
  const { data: events } = useRevenueEvents()
  const { data: metrics, isLoading: metricsLoading } = usePlatformMetrics()

  const published = (posts ?? []).filter((post) => post.status === 'published').length
  const autoDrafted = (posts ?? []).filter((post) => post.source === 'auto').length
  const totalRevenue = (events ?? []).reduce((sum, event) => sum + Number(event.amount), 0)
  const avgPerEvent = events && events.length > 0 ? totalRevenue / events.length : 0

  const accountMetrics = latestByName(metrics ?? [], null)
  const hasRealInsights = accountMetrics.size > 0

  const publishedWithMetrics = (posts ?? [])
    .filter((post) => post.status === 'published' && post.platform_media_id)
    .map((post) => ({ post, metrics: latestByName(metrics ?? [], post.id) }))
    .filter(({ metrics: postMetrics }) => postMetrics.size > 0)

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Analytics</span>
          <h1>Insights</h1>
          <p>
            {hasRealInsights
              ? 'Reach and engagement synced from the Instagram Graph API, alongside your own logged activity.'
              : 'Aggregate stats from your own data. Real Instagram reach/engagement lands here once sync-instagram-insights has run against a connected account.'}
          </p>
        </div>
      </div>

      <section className="metric-grid" aria-label="Insights">
        <MetricCard label="Posts published" value={String(published)} icon="+" caption="All time" />
        <MetricCard label="Auto-drafted posts" value={String(autoDrafted)} icon="~" caption="Generated from trends" />
        <MetricCard label="Avg. revenue / entry" value={currency.format(avgPerEvent)} icon="$" caption="Across all logged revenue" dark />
      </section>

      {hasRealInsights && (
        <section className="metric-grid" aria-label="Instagram account insights">
          {Object.entries(ACCOUNT_METRIC_LABELS).map(([key, label]) =>
            accountMetrics.has(key) ? (
              <MetricCard
                key={key}
                label={label}
                value={number.format(accountMetrics.get(key) ?? 0)}
                icon="IG"
                caption="Last synced day"
              />
            ) : null,
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Instagram</span>
            <h2>Post performance</h2>
          </div>
        </div>
        {metricsLoading && <p className="empty-state">Loading…</p>}
        {!metricsLoading && publishedWithMetrics.length === 0 && (
          <p className="empty-state">No per-post insights yet -- data appears once a post is at least 24h old and has been synced.</p>
        )}
        <div className="queue-list">
          {publishedWithMetrics.map(({ post, metrics: postMetrics }) => (
            <div className="queue-item" key={post.id}>
              <div className="queue-title">
                <strong>{post.title}</strong>
                <span>
                  {[...postMetrics.entries()]
                    .map(([name, value]) => `${name.replace(/_/g, ' ')}: ${number.format(value)}`)
                    .join(' · ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
