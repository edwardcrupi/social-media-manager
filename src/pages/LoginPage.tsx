import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../providers/AuthProvider'

export function LoginPage() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  if (!loading && session) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setStatus('sending')
    setError('')
    const { error: signInError } = await supabase.auth.signInWithOtp({ email })
    if (signInError) {
      setError(signInError.message)
      setStatus('error')
      return
    }
    setStatus('sent')
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand"><span className="brand-mark">S</span><span>signal / social</span></div>
        <h1>Sign in</h1>
        <p>We'll email you a magic link — no password needed.</p>
        {status === 'sent' ? (
          <div className="login-sent">Check your email for a sign-in link.</div>
        ) : (
          <>
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button className="primary-button" type="submit" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <p className="login-error">{error}</p>}
          </>
        )}
      </form>
    </div>
  )
}
