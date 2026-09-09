import { useLocation } from 'react-router-dom'
import { useAuth } from '../../providers/AuthProvider'

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Overview',
  '/content-queue': 'Content queue',
  '/profiles': 'Profiles',
  '/revenue': 'Revenue',
  '/insights': 'Insights',
  '/settings': 'Settings',
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

export function Topbar() {
  const location = useLocation()
  const { user } = useAuth()
  const label = ROUTE_LABELS[location.pathname] ?? 'Overview'
  const initials = (user?.email ?? '?').slice(0, 2).toUpperCase()

  return (
    <header className="topbar">
      <div className="breadcrumb">
        Workspace <span>/</span> {label}
      </div>
      <div className="top-actions">
        <span className="date-chip">{dateFormatter.format(new Date())}</span>
        <button className="icon-button" aria-label="Notifications">o</button>
        <button className="avatar user-avatar">{initials}</button>
      </div>
    </header>
  )
}
