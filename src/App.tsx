import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from './providers/AuthProvider'
import { queryClient } from './lib/queryClient'
import { router } from './routes'
import './App.css'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
