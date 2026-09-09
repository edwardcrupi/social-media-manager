import { usePosts } from '../hooks/usePosts'
import { useRevenueEvents } from '../hooks/useRevenueEvents'
import { MetricCard } from '../components/metrics/MetricCard'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function InsightsPage() {
  const { data: posts } = usePosts()
  const { data: events } = useRevenueEvents()

  const published = (posts ?? []).filter((post) => post.status === 'published').length
  const autoDrafted = (posts ?? []).filter((post) => post.source === 'auto').length
  const totalRevenue = (events ?? []).reduce((sum, event) => sum + Number(event.amount), 0)
  const avgPerEvent = events && events.length > 0 ? totalRevenue / events.length : 0

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Analytics</span>
          <h1>Insights</h1>
          <p>Aggregate stats from your own data. Real platform insights (reach, engagement) arrive once Instagram/TikTok API access is approved.</p>
        </div>
      </div>

      <section className="metric-grid" aria-label="Insights">
        <MetricCard label="Posts published" value={String(published)} icon="+" caption="All time" />
        <MetricCard label="Auto-drafted posts" value={String(autoDrafted)} icon="~" caption="Generated from trends" />
        <MetricCard label="Avg. revenue / entry" value={currency.format(avgPerEvent)} icon="$" caption="Across all logged revenue" dark />
      </section>
    </>
  )
}
