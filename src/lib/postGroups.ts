import type { PostRow } from '../types/database'

// One generated idea fans out to a post row per eligible platform, all
// pointing at the same uploaded image or video. Group them back into the
// idea they came from, preserving order, so the queue shows each idea once
// instead of the same item repeated four times.
//
// Rows are grouped, never dropped: each platform keeps its own status and
// its own controls, since a post can succeed on Facebook and fail on X.
export function groupBySharedMedia(posts: PostRow[]): PostRow[][] {
  const groups: PostRow[][] = []
  const byMediaUrl = new Map<string, PostRow[]>()
  for (const post of posts) {
    // A post with no media yet (drafting, generating, failed) has nothing to
    // share, so it stands alone.
    if (!post.media_url) {
      groups.push([post])
      continue
    }
    const existing = byMediaUrl.get(post.media_url)
    if (existing) {
      existing.push(post)
    } else {
      const group = [post]
      byMediaUrl.set(post.media_url, group)
      groups.push(group)
    }
  }
  return groups
}
