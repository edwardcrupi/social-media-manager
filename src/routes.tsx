import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { RequireAuth } from './routes/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { OverviewPage } from './pages/OverviewPage'
import { ContentQueuePage } from './pages/ContentQueuePage'
import { ProfilesPage } from './pages/ProfilesPage'
import { RevenuePage } from './pages/RevenuePage'
import { InsightsPage } from './pages/InsightsPage'
import { SettingsPage } from './pages/SettingsPage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <OverviewPage /> },
          { path: '/content-queue', element: <ContentQueuePage /> },
          { path: '/profiles', element: <ProfilesPage /> },
          { path: '/revenue', element: <RevenuePage /> },
          { path: '/insights', element: <InsightsPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
])
