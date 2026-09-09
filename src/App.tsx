import { useState } from 'react'
import './App.css'

type Profile = { name: string; handle: string; platform: string; tone: string; followers: string; accent: string }

const profiles: Profile[] = [
  { name: 'Studio North', handle: '@studionorth', platform: 'Instagram', tone: 'Creator brand', followers: '18.4k', accent: 'coral' },
  { name: 'The Weekly Edit', handle: '@weeklyedit', platform: 'TikTok', tone: 'Media brand', followers: '42.1k', accent: 'yellow' },
  { name: 'Mara & Co.', handle: '@maraandco', platform: 'Pinterest', tone: 'Product brand', followers: '9.8k', accent: 'blue' },
]

const queue = [
  { day: 'Today', time: '4:30 PM', title: '3 ways to turn one idea into a week of content', tag: 'Education', status: 'Ready', color: 'coral' },
  { day: 'Tomorrow', time: '11:00 AM', title: 'The creator toolkit I actually use every day', tag: 'Affiliate', status: 'Draft', color: 'yellow' },
  { day: 'Thu, Sep 11', time: '6:00 PM', title: 'Behind the scenes: building a tiny media brand', tag: 'Story', status: 'Ready', color: 'blue' },
]

function App() {
  const [activeProfile, setActiveProfile] = useState(0)
  const [activeNav, setActiveNav] = useState('Overview')
  const [showComposer, setShowComposer] = useState(false)
  const profile = profiles[activeProfile]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>signal / social</span></div>
        <div className="workspace-label">Workspace</div>
        <button className="profile-switcher" onClick={() => setActiveProfile((activeProfile + 1) % profiles.length)}>
          <span className={`avatar ${profile.accent}`}>{profile.name[0]}</span>
          <span><strong>{profile.name}</strong><small>{profile.handle}</small></span><span className="chevron">v</span>
        </button>
        <nav aria-label="Main navigation">
          {['Overview', 'Content queue', 'Profiles', 'Revenue', 'Insights'].map((item) => (
            <button className={activeNav === item ? 'nav-item active' : 'nav-item'} onClick={() => setActiveNav(item)} key={item}>
              <span className="nav-dot" />{item}{item === 'Content queue' && <span className="nav-count">3</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="goal-card"><span className="eyebrow">Monthly target</span><strong>$5,000</strong><div className="progress"><span /></div><small>$3,840 collected <b>76.8%</b></small></div>
          <button className="nav-item"><span className="nav-dot" />Settings</button>
          <div className="user-row"><span className="user-avatar">EC</span><span><strong>Edward Crupi</strong><small>Owner</small></span><span className="more">...</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> {activeNav}</div><div className="top-actions"><span className="date-chip">Tue, Sep 8, 2026</span><button className="icon-button" aria-label="Notifications">o</button><button className="avatar user-avatar">EC</button></div></header>
        <div className="page-content">
          <div className="page-heading"><div><span className="eyebrow">Tuesday, September 8, 2026</span><h1>Good morning, Edward.</h1><p>Here is how your social business is performing this week.</p></div><button className="primary-button" onClick={() => setShowComposer(!showComposer)}><span>+</span> Create content</button></div>

          <section className="metric-grid" aria-label="Business metrics">
            <article className="metric-card dark-card"><div className="metric-head"><span>Attributed revenue</span><span className="metric-icon">$</span></div><strong>$3,840.20</strong><div className="metric-foot"><span className="positive">+18.4%</span><span>vs. last month</span><span className="sparkline coral-line" /></div></article>
            <article className="metric-card"><div className="metric-head"><span>Audience reached</span><span className="metric-icon light">+</span></div><strong>128.6k</strong><div className="metric-foot"><span className="positive">+24.8%</span><span>vs. last month</span><span className="sparkline yellow-line" /></div></article>
            <article className="metric-card"><div className="metric-head"><span>Link conversion</span><span className="metric-icon light">%</span></div><strong>4.82%</strong><div className="metric-foot"><span className="positive">+0.64%</span><span>vs. last month</span><span className="sparkline blue-line" /></div></article>
          </section>

          <section className="content-grid">
            <article className="panel performance-panel"><div className="panel-header"><div><span className="eyebrow">Performance</span><h2>Revenue by channel</h2></div><button className="select-button">Last 30 days <span>v</span></button></div><div className="chart"><div className="chart-labels"><span>$4k</span><span>$3k</span><span>$2k</span><span>$1k</span><span>$0</span></div><div className="chart-body"><div className="grid-lines"><i /><i /><i /><i /><i /></div><div className="bars"><span style={{ height: '36%' }}><b>Instagram</b></span><span style={{ height: '51%' }}><b>TikTok</b></span><span style={{ height: '42%' }}><b>Pinterest</b></span><span style={{ height: '68%' }}><b>Newsletter</b></span><span style={{ height: '84%' }}><b>Affiliate</b></span><span style={{ height: '63%' }}><b>Shop</b></span></div><div className="chart-months"><span>Aug 10</span><span>Aug 17</span><span>Aug 24</span><span>Aug 31</span><span>Sep 7</span></div></div></div><div className="legend"><span><i className="legend-dot coral" />Affiliate <b>$1,820</b></span><span><i className="legend-dot yellow" />Instagram <b>$1,140</b></span><span><i className="legend-dot blue" />Other <b>$880</b></span></div></article>
            <article className="panel profile-panel"><div className="panel-header"><div><span className="eyebrow">Active profile</span><h2>{profile.name}</h2></div><button className="more-button">...</button></div><div className="profile-hero"><div className={`profile-avatar ${profile.accent}`}>{profile.name[0]}</div><div><strong>{profile.handle}</strong><span>{profile.platform} / {profile.tone}</span></div><span className="live-dot">Live</span></div><div className="profile-stats"><div><strong>{profile.followers}</strong><span>Followers</span></div><div><strong>6.2%</strong><span>Engagement</span></div><div><strong>2.8x</strong><span>ROI</span></div></div><div className="profile-note"><span>i</span><p><strong>Next best move</strong> Promote your affiliate tutorial to this audience. Similar posts earned 3.4x more clicks.</p></div><button className="outline-button">View profile insights <span>-&gt;</span></button></article>
          </section>

          <section className="panel queue-panel"><div className="panel-header"><div><span className="eyebrow">Up next</span><h2>Content queue</h2></div><button className="text-button" onClick={() => setActiveNav('Content queue')}>View all <span>-&gt;</span></button></div><div className="queue-list">{queue.map((item) => <div className="queue-item" key={item.title}><span className={`queue-date ${item.color}`}><b>{item.day}</b><small>{item.time}</small></span><div className="queue-title"><strong>{item.title}</strong><span>{item.tag}</span></div><span className={item.status === 'Ready' ? 'status ready' : 'status draft'}><i />{item.status}</span><button className="more-button">...</button></div>)}</div></section>
          {showComposer && <div className="composer"><div><span className="eyebrow">Quick draft</span><h2>What are you publishing next?</h2></div><input autoFocus placeholder="Write a hook or paste a content idea..." /><button className="primary-button" onClick={() => setShowComposer(false)}>Save draft</button></div>}
        </div>
      </main>
    </div>
  )
}

export default App