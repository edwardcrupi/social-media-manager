// X's text rules, in one place: the publish path needs them to stay under the
// limit, and the generation path needs them to draft a caption that fits in
// the first place.
//
// History worth keeping: this logic used to live only in
// publish-scheduled-posts and was wrong in a way that broke X publishing for
// eight days. `slice(0, 279) + '…'` is exactly 280 JavaScript characters and
// 281 *weighted* ones, because U+2026 sits outside every weight-1 range. X
// rejects that with a generic `403 You are not permitted to perform this
// action` -- no reason code, no mention of length -- which reads exactly like
// an app-permissions problem. See PLAN.md Phase 10.

// Weight-1 ranges from X's twitter-text configuration; everything else
// weighs 2 (emoji, CJK, and -- the one that bit us -- the ellipsis).
export function xCharWeight(codePoint: number): number {
  if (codePoint <= 0x10ff) return 1
  if (codePoint >= 0x2000 && codePoint <= 0x200d) return 1
  if (codePoint >= 0x2010 && codePoint <= 0x201f) return 1
  if (codePoint >= 0x2032 && codePoint <= 0x2037) return 1
  return 2
}

export function xWeightedLength(text: string): number {
  let total = 0
  // for..of walks code points, so an emoji measures as one unit rather than
  // two UTF-16 halves -- and can never be sliced into a lone surrogate.
  for (const char of text) total += xCharWeight(char.codePointAt(0) as number)
  return total
}

export const X_TWEET_MAX_WEIGHTED = 280
// Every URL costs exactly 23 regardless of its real length (t.co wrapping).
export const X_URL_WEIGHTED_LENGTH = 23

// How many characters a drafted X caption may use, given what will be
// appended to it. Passed into the generation prompt so the model writes
// something that fits instead of something that gets amputated later.
export function xCaptionBudget(willAppendLink: boolean, disclosure: string | null): number {
  if (!willAppendLink) return X_TWEET_MAX_WEIGHTED
  const disclosureCost = disclosure ? xWeightedLength(disclosure) + 1 : 0
  return X_TWEET_MAX_WEIGHTED - X_URL_WEIGHTED_LENGTH - 2 - disclosureCost
}

// Last-resort guard. With an x_caption drafted to budget this is a no-op;
// it still matters for manually-created posts and for rows generated before
// x_caption existed.
//
// The trailing paragraph is preserved whole when it contains a URL, because
// that paragraph is the tracked link *and its affiliate disclosure* -- a
// disclosure is not something to truncate, and a severed URL is both
// unclickable and billed at X's $0.20 with-a-URL rate instead of $0.015.
export function truncateForX(text: string): string {
  const lastBreak = text.lastIndexOf('\n\n')
  const trailingBlock = lastBreak === -1 ? null : text.slice(lastBreak + 2)
  const hasTrailingLink = trailingBlock !== null && /https?:\/\/\S+/.test(trailingBlock)

  const body = hasTrailingLink ? text.slice(0, lastBreak) : text
  const tail = hasTrailingLink ? (trailingBlock as string) : null

  // The tail's own URL is measured as 23, not as its literal length.
  const tailCost = tail
    ? xWeightedLength(tail.replace(/https?:\/\/\S+/, '')) + X_URL_WEIGHTED_LENGTH + 2
    : 0

  if (xWeightedLength(body) + tailCost <= X_TWEET_MAX_WEIGHTED) {
    return tail ? `${body}\n\n${tail}` : body
  }

  const budget = X_TWEET_MAX_WEIGHTED - tailCost - 2 // 2 = the ellipsis
  if (budget <= 0) return tail ?? ''

  let kept = ''
  let weight = 0
  for (const char of body) {
    const charWeight = xCharWeight(char.codePointAt(0) as number)
    if (weight + charWeight > budget) break
    kept += char
    weight += charWeight
  }

  // Back off to a word boundary, but not if that throws away a big chunk.
  const lastSpace = kept.lastIndexOf(' ')
  if (lastSpace > budget * 0.6) kept = kept.slice(0, lastSpace)
  kept = kept.trimEnd().replace(/[,;:—-]$/, '').trimEnd()

  // An ellipsis after a complete sentence just reads as a typo ("Nobody asked
  // for this.…" -- seen on a real generated post). If the cut happens to land
  // on sentence-ending punctuation, the text already reads as finished.
  const endsASentence = /[.!?"'’”]$/.test(kept)
  const ellipsis = endsASentence ? '' : '…'

  return tail ? `${kept}${ellipsis}\n\n${tail}` : `${kept}${ellipsis}`
}
