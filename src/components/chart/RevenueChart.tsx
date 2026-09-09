import type { RevenueEventRow } from '../../types/database'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const dotClasses = ['coral', 'yellow', 'blue']

export function RevenueChart({ events }: { events: RevenueEventRow[] }) {
  const totalsBySource = new Map<string, number>()
  for (const event of events) {
    totalsBySource.set(event.source, (totalsBySource.get(event.source) ?? 0) + Number(event.amount))
  }
  const bars = [...totalsBySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const max = Math.max(1, ...bars.map(([, amount]) => amount))
  const scaleSteps = [max, max * 0.75, max * 0.5, max * 0.25, 0]

  if (bars.length === 0) {
    return <p className="empty-state">No revenue logged yet — add your first entry on the Revenue page.</p>
  }

  return (
    <>
      <div className="chart">
        <div className="chart-labels">
          {scaleSteps.map((step) => (
            <span key={step}>{currency.format(step)}</span>
          ))}
        </div>
        <div className="chart-body">
          <div className="grid-lines">
            {scaleSteps.map((step) => (
              <i key={step} />
            ))}
          </div>
          <div className="bars">
            {bars.map(([source, amount]) => (
              <span key={source} style={{ height: `${Math.max(6, (amount / max) * 100)}%` }}>
                <b>{source}</b>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="legend">
        {bars.slice(0, 3).map(([source, amount], index) => (
          <span key={source}>
            <i className={`legend-dot ${dotClasses[index % dotClasses.length]}`} />
            {source} <b>{currency.format(amount)}</b>
          </span>
        ))}
      </div>
    </>
  )
}
