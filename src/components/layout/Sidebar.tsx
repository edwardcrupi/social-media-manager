import { NavLink } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../../providers/AuthProvider'
import { useSocialProfiles } from '../../hooks/useSocialProfiles'
import { useRevenueEvents } from '../../hooks/useRevenueEvents'
import { supabase } from '../../lib/supabase'

const NAV_ITEMS = [
  { label: 'Overview', to: '/' },
  { label: 'Content queue', to: '/content-queue' },
  { label: 'Profiles', to: '/profiles' },
  { label: 'Revenue', to: '/revenue' },
  { label: 'Insights', to: '/insights' },
]

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function Sidebar() {
  const { user } = useAuth()
  const { data: profiles } = useSocialProfiles()
  const { data: revenueEvents } = useRevenueEvents()
  const [activeProfile, setActiveProfile] = useState(0)

  const profile = profiles && profiles.length > 0 ? profiles[activeProfile % profiles.length] : null
  const totalRevenue = (revenueEvents ?? []).reduce((sum, event) => sum + Number(event.amount), 0)
  const initials = (user?.email ?? '?').slice(0, 2).toUpperCase()

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">S</span>
        <span>signal / social</span>
      </div>
      <div className="workspace-label">Workspace</div>
      <button
        className="profile-switcher"
        onClick={() => profiles && setActiveProfile((activeProfile + 1) % profiles.length)}
      >
        {profile ? (
          <>
            <span className={`avatar ${profile.accent}`}>{profile.display_name[0]}</span>
            <span>
              <strong>{profile.display_name}</strong>
              <small>{profile.handle}</small>
            </span>
            <span className="chevron">v</span>
          </>
        ) : (
          <span>No profiles yet — add one</span>
        )}
      </button>
      <nav aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
          >
            <span className="nav-dot" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="goal-card">
          <span className="eyebrow">Revenue collected</span>
          <strong>{currency.format(totalRevenue)}</strong>
          <small>{(revenueEvents ?? []).length} logged events</small>
        </div>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
          <span className="nav-dot" />Settings
        </NavLink>
        <div className="user-row">
          <span className="user-avatar">{initials}</span>
          <span>
            <strong>{user?.email}</strong>
            <small>Owner</small>
          </span>
          <button className="more" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
