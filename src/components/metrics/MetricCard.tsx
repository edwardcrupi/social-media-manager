interface MetricCardProps {
  label: string
  value: string
  icon: string
  caption: string
  dark?: boolean
}

export function MetricCard({ label, value, icon, caption, dark }: MetricCardProps) {
  return (
    <article className={dark ? 'metric-card dark-card' : 'metric-card'}>
      <div className="metric-head">
        <span>{label}</span>
        <span className={dark ? 'metric-icon' : 'metric-icon light'}>{icon}</span>
      </div>
      <strong>{value}</strong>
      <div className="metric-foot">
        <span>{caption}</span>
      </div>
    </article>
  )
}
