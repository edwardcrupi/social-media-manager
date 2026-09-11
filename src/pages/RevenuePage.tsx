import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRevenueEvents, useCreateRevenueEvent, useDeleteRevenueEvent } from '../hooks/useRevenueEvents'
import { useShortLinks, useCreateShortLink, useDeleteShortLink, useLinkClickCounts } from '../hooks/useShortLinks'
import { usePosts } from '../hooks/usePosts'
import { RevenueChart } from '../components/chart/RevenueChart'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function shortLinkUrl(slug: string) {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/redirect/${slug}`
}

function ShortLinksPanel() {
  const { data: links, isLoading } = useShortLinks()
  const { data: clickCounts } = useLinkClickCounts()
  const { data: posts } = usePosts()
  const createLink = useCreateShortLink()
  const deleteLink = useDeleteShortLink()

  const [destinationUrl, setDestinationUrl] = useState('')
  const [campaign, setCampaign] = useState('')
  const [postId, setPostId] = useState('')
  const [copiedId, setCopiedId] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!destinationUrl.trim()) return
    createLink.mutate(
      {
        slug: crypto.randomUUID().slice(0, 8),
        destination_url: destinationUrl.trim(),
        post_id: postId || null,
        utm_source: 'instagram',
        utm_medium: 'social',
        utm_campaign: campaign.trim() || null,
      },
      {
        onSuccess: () => {
          setDestinationUrl('')
          setCampaign('')
          setPostId('')
        },
      },
    )
  }

  function copyLink(id: string, slug: string) {
    navigator.clipboard.writeText(shortLinkUrl(slug))
    setCopiedId(id)
    setTimeout(() => setCopiedId(''), 1500)
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Attribution</span>
          <h2>Short links</h2>
        </div>
      </div>
      <form className="composer" onSubmit={handleSubmit}>
        <input
          placeholder="Destination URL (e.g. your affiliate link)"
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
        />
        <input placeholder="Campaign (optional)" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        <select value={postId} onChange={(e) => setPostId(e.target.value)}>
          <option value="">No post</option>
          {(posts ?? []).map((post) => (
            <option key={post.id} value={post.id}>
              {post.title}
            </option>
          ))}
        </select>
        <button className="primary-button" type="submit" disabled={createLink.isPending}>
          {createLink.isPending ? 'Creating…' : 'Create link'}
        </button>
        {createLink.isError && (
          <p className="login-error">
            {createLink.error instanceof Error ? createLink.error.message : 'Failed to create link.'}
          </p>
        )}
      </form>

      {isLoading && <p className="empty-state">Loading…</p>}
      {links?.length === 0 && <p className="empty-state">No short links yet.</p>}
      <div className="queue-list">
        {links?.map((link) => (
          <div className="queue-item" key={link.id}>
            <div className="queue-title">
              <strong>{link.utm_campaign || link.destination_url}</strong>
              <span>
                {clickCounts?.[link.id] ?? 0} click{clickCounts?.[link.id] === 1 ? '' : 's'} · {link.destination_url}
              </span>
            </div>
            <button className="outline-button" onClick={() => copyLink(link.id, link.slug)} style={{ width: 'auto' }}>
              {copiedId === link.id ? 'Copied!' : 'Copy link'}
            </button>
            <button className="more-button" onClick={() => deleteLink.mutate(link.id)} aria-label="Delete">
              x
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

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
          <p>Revenue amounts are still logged manually; short links below track real click-through.</p>
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

      <ShortLinksPanel />

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
