import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRevenueEvents, useCreateRevenueEvent, useDeleteRevenueEvent } from '../hooks/useRevenueEvents'
import { RevenueChart } from '../components/chart/RevenueChart'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function RevenuePage() {
  const { data: events, isLoading } = useRevenueEvents()
  const createEvent = useCreateRevenueEvent()
  const deleteEvent = useDeleteRevenueEvent()

  const [source, setSource] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsedAmount = Number(amount)
    if (!source.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return
    createEvent.mutate(
      {
        source: source.trim(),
        amount: parsedAmount,
        occurred_at: new Date().toISOString(),
        note: note.trim() || null,
        short_link_id: null,
        post_id: null,
      },
      {
        onSuccess: () => {
          setSource('')
          setAmount('')
          setNote('')
        },
      },
    )
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Attribution</span>
          <h1>Revenue</h1>
          <p>Logged manually today — link-click attribution lands once short links ship.</p>
        </div>
      </div>

      <section className="panel performance-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Performance</span>
            <h2>Revenue by source</h2>
          </div>
        </div>
        <RevenueChart events={events ?? []} />
      </section>

      <section className="panel">
        <form className="composer" onSubmit={handleSubmit}>
          <input placeholder="Source (e.g. Affiliate, Instagram)" value={source} onChange={(e) => setSource(e.target.value)} />
          <input
            placeholder="Amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ maxWidth: 120 }}
          />
          <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary-button" type="submit" disabled={createEvent.isPending}>
            {createEvent.isPending ? 'Logging…' : 'Log revenue'}
          </button>
          {createEvent.isError && (
            <p className="login-error">
              {createEvent.error instanceof Error ? createEvent.error.message : 'Failed to log revenue.'}
            </p>
          )}
        </form>
      </section>

      <section className="panel queue-panel">
        {isLoading && <p className="empty-state">Loading…</p>}
        {events?.length === 0 && <p className="empty-state">No revenue logged yet.</p>}
        <div className="queue-list">
          {events?.map((event) => (
            <div className="queue-item" key={event.id}>
              <span className="queue-date coral">
                <b>{dateFormatter.format(new Date(event.occurred_at))}</b>
              </span>
              <div className="queue-title">
                <strong>{currency.format(Number(event.amount))}</strong>
                <span>
                  {event.source}
                  {event.note ? ` · ${event.note}` : ''}
                </span>
              </div>
              <button className="more-button" onClick={() => deleteEvent.mutate(event.id)} aria-label="Delete">
                x
              </button>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
