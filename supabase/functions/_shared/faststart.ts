// Moves an MP4's `moov` atom from the end of the file to the front.
//
// Seedance returns MP4s laid out as [ftyp][uuid][free][mdat][moov] -- the
// index is the last 13KB of a 17MB file. A player that wants one frame must
// therefore find `moov` before it can find anything else, and a browser
// given such a file will pull far more of it than the frame is worth. That
// is what made the Content Queue's video thumbnails cost 600+MB of cached
// egress in a day (migration 0018).
//
// Reordered to [ftyp][moov][uuid][free][mdat], the same thumbnail costs a
// 13KB range request for `moov` plus ~140KB for the first keyframe -- about
// 153KB against 17.4MB, or 114x less -- and the browser does it natively via
// Range requests, with no client-side MP4 handling at all. It also makes the
// files progressively playable for Instagram/TikTok/X, which pull these URLs
// server-side.
//
// This is a pure byte reordering: no re-encode, no decode, no quality
// change. The only edit is to the chunk offset tables (`stco`/`co64`), which
// hold absolute file offsets and so must be shifted by however far the media
// data moved. Verified against the real output: every frame of a remuxed
// video decodes to a byte-identical MD5, which is the same thing
// `ffmpeg -movflags +faststart` does.

// Boxes whose payload is a sequence of child boxes. Anything not listed here
// is treated as opaque -- important, because scanning opaque payloads for a
// four-byte type would eventually match media bytes by chance and corrupt
// the file.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'mvex'])

type Box = { type: string; start: number; size: number; headerSize: number }

function readBoxes(buf: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const boxes: Box[] = []
  let off = start
  while (off + 8 <= end) {
    let size = view.getUint32(off)
    let headerSize = 8
    if (size === 1) {
      if (off + 16 > end) break
      // 64-bit size. Safe as a Number: these are file offsets, far under 2^53.
      const hi = view.getUint32(off + 8)
      const lo = view.getUint32(off + 12)
      size = hi * 2 ** 32 + lo
      headerSize = 16
    } else if (size === 0) {
      // Runs to the end of the file.
      size = end - off
    }
    if (size < headerSize || off + size > end) break
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7])
    boxes.push({ type, start: off, size, headerSize })
    off += size
  }
  return boxes
}

// Walks `moov` properly rather than scanning it, and adds `delta` to every
// chunk offset that points at media which moved.
function shiftChunkOffsets(moov: Uint8Array, delta: number, movedBelow: number): number {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  let patched = 0

  const visit = (start: number, end: number) => {
    for (const box of readBoxes(moov, start, end)) {
      if (box.type === 'stco' || box.type === 'co64') {
        // FullBox: 4 bytes of version/flags, then a uint32 entry count.
        const base = box.start + box.headerSize + 4
        const count = view.getUint32(base)
        let p = base + 4
        for (let i = 0; i < count; i++) {
          if (box.type === 'stco') {
            const value = view.getUint32(p)
            // Only media that sat before the old moov actually moved; a
            // chunk living past it (rare, but legal) keeps its offset.
            if (value < movedBelow) view.setUint32(p, value + delta)
            p += 4
          } else {
            const hi = view.getUint32(p)
            const lo = view.getUint32(p + 4)
            const value = hi * 2 ** 32 + lo
            if (value < movedBelow) {
              const shifted = value + delta
              view.setUint32(p, Math.floor(shifted / 2 ** 32))
              view.setUint32(p + 4, shifted >>> 0)
            }
            p += 8
          }
          patched++
        }
      } else if (CONTAINERS.has(box.type)) {
        visit(box.start + box.headerSize, box.start + box.size)
      }
    }
  }

  visit(0, moov.length)
  return patched
}

export type FaststartResult = {
  bytes: Uint8Array
  /** False when the input was already faststart, unparseable, or had no moov. */
  changed: boolean
  reason: string
  offsetsPatched: number
}

export function toFaststart(input: Uint8Array): FaststartResult {
  const unchanged = (reason: string): FaststartResult => ({
    bytes: input,
    changed: false,
    reason,
    offsetsPatched: 0,
  })

  const top = readBoxes(input, 0, input.length)
  if (top.length === 0) return unchanged('not an MP4 box structure')

  const ftyp = top[0]
  if (ftyp.type !== 'ftyp') return unchanged('does not start with ftyp')

  const moovIndex = top.findIndex((box) => box.type === 'moov')
  if (moovIndex === -1) return unchanged('no moov box')
  if (moovIndex === 1) return unchanged('already faststart')

  // Anything the boxes don't account for (a truncated or trailing tail) means
  // the offsets can't be trusted -- leave the file alone rather than corrupt
  // it.
  const last = top[top.length - 1]
  if (last.start + last.size !== input.length) return unchanged('trailing bytes outside the box structure')

  const moov = top[moovIndex]
  const moovCopy = input.slice(moov.start, moov.start + moov.size)
  // moov lands directly after ftyp, so everything that was between them
  // slides forward by exactly moov's size.
  const offsetsPatched = shiftChunkOffsets(moovCopy, moov.size, moov.start)

  const out = new Uint8Array(input.length)
  let cursor = 0
  out.set(input.subarray(0, ftyp.size), cursor)
  cursor += ftyp.size
  out.set(moovCopy, cursor)
  cursor += moovCopy.length
  out.set(input.subarray(ftyp.size, moov.start), cursor)
  cursor += moov.start - ftyp.size
  out.set(input.subarray(moov.start + moov.size), cursor)

  return { bytes: out, changed: true, reason: 'moved moov to the front', offsetsPatched }
}
