import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        <Topbar />
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
