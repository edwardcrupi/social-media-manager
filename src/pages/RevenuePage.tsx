import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRevenueEvents, useCreateRevenueEvent, useDeleteRevenueEvent } from '../hooks/useRevenueEvents'
import { useShortLinks, useCreateShortLink, useDeleteShortLink, useLinkClickCounts } from '../hooks/useShortLinks'
import {
  useAffiliateOffers,
  useCreateAffiliateOffer,
  useDeleteAffiliateOffer,
  useUpdateAffiliateOffer,
} from '../hooks/useAffiliateOffers'
import { usePosts } from '../hooks/usePosts'
import { RevenueChart } from '../components/chart/RevenueChart'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function shortLinkUrl(slug: string) {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/redirect/${slug}`
}

// Phase 12 Step 1. Without at least one row here, every auto-generated post
// goes out with no offer and nothing tracked -- which is what the entire
// attribution stack was built for and then left idle. An offer pointing at
// your own newsletter or landing page is a perfectly valid first row; it
// doesn't have to wait on an affiliate network approving anything.
function OffersPanel() {
  const { data: offers, isLoading } = useAffiliateOffers()
  const { data: links } = useShortLinks()
  const { data: clickCounts } = useLinkClickCounts()
  const createOffer = useCreateAffiliateOffer()
  const updateOffer = useUpdateAffiliateOffer()
  const deleteOffer = useDeleteAffiliateOffer()

  const [programName, setProgramName] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [keywords, setKeywords] = useState('')
  const [disclosure, setDisclosure] = useState('')

  // Clicks per offer, aggregated client-side from the short links already
  // loaded for the panel below -- same reasoning as useLinkClickCounts.
  const clicksByOffer: Record<string, number> = {}
  for (const link of links ?? []) {
    if (!link.affiliate_offer_id) continue
    clicksByOffer[link.affiliate_offer_id] =
      (clicksByOffer[link.affiliate_offer_id] ?? 0) + (clickCounts?.[link.id] ?? 0)
  }

  const activeOffers = (offers ?? []).filter((offer) => offer.active)
  const fallbackOfferId = activeOffers[0]?.id

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!programName.trim() || !destinationUrl.trim()) return
    createOffer.mutate(
      {
        program_name: programName.trim(),
        destination_url: destinationUrl.trim(),
        keywords: keywords
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean),
        disclosure: disclosure.trim() || null,
      },
      {
        onSuccess: () => {
          setProgramName('')
          setDestinationUrl('')
          setKeywords('')
          setDisclosure('')
        },
      },
    )
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Monetization</span>
          <h2>Offers</h2>
          <p className="panel-note">
            Auto-generated posts get a tracked link to whichever of these fits the topic. With no active offer, posts
            publish with nothing to click. Affiliate links need a disclosure — these posts publish with no review step.
          </p>
        </div>
      </div>
      <form className="composer" onSubmit={handleSubmit}>
        <input placeholder="Program name" value={programName} onChange={(e) => setProgramName(e.target.value)} />
        <input
          placeholder="Destination URL"
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
        />
        <input
          placeholder="Topic keywords (comma-separated)"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
        <input
          placeholder="Disclosure (required for affiliate links)"
          value={disclosure}
          onChange={(e) => setDisclosure(e.target.value)}
        />
        <button className="primary-button" type="submit" disabled={createOffer.isPending}>
          {createOffer.isPending ? 'Adding…' : 'Add offer'}
        </button>
        {createOffer.isError && (
          <p className="login-error">
            {createOffer.error instanceof Error ? createOffer.error.message : 'Failed to add offer.'}
          </p>
        )}
      </form>

      {isLoading && <p className="empty-state">Loading…</p>}
      {offers?.length === 0 && <p className="empty-state">No offers yet — posts are publishing untracked.</p>}
      <div className="queue-list">
        {offers?.map((offer) => (
          <div className="queue-item" key={offer.id}>
            <div className="queue-title">
              <strong>
                {offer.program_name}
                {!offer.active && ' (paused)'}
                {offer.id === fallbackOfferId && ' · fallback'}
              </strong>
              <span>
                {clicksByOffer[offer.id] ?? 0} click{clicksByOffer[offer.id] === 1 ? '' : 's'} · {offer.destination_url}
                {offer.keywords.length > 0 ? ` · ${offer.keywords.join(', ')}` : ''}
                {offer.active && !offer.disclosure ? ' · no disclosure set' : ''}
              </span>
            </div>
            <button
              className="outline-button"
              style={{ width: 'auto' }}
              onClick={() => updateOffer.mutate({ id: offer.id, active: !offer.active })}
            >
              {offer.active ? 'Pause' : 'Activate'}
            </button>
            <button className="more-button" onClick={() => deleteOffer.mutate(offer.id)} aria-label="Delete">
              x
            </button>
          </div>
        ))}
      </div>
    </section>
  )
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
  const chartEvents = (events ?? []).filter((event) => event.status !== 'reversed')

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
        <RevenueChart events={chartEvents} />
      </section>

      <OffersPanel />

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
                <strong>
                  {currency.format(Number(event.amount))}
                  {event.status === 'pending' && ' (pending)'}
                  {event.status === 'reversed' && ' (reversed)'}
                </strong>
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
