// Every object this app writes to Storage is content-addressed by a fresh
// crypto.randomUUID() filename and never overwritten in place, so it can be
// cached indefinitely and safely.
//
// Without this, supabase-js leaves the object with `cache-control: no-cache`,
// which forces the browser to revalidate every media object on every single
// page load instead of reusing its local copy -- one of the four things that
// together produced 600+MB of cached egress in a day (see migration 0018).
export const IMMUTABLE_CACHE_CONTROL = '31536000'
