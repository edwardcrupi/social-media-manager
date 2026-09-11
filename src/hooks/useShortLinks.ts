import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ShortLinkInsert } from '../types/database'

const LINKS_KEY = ['short_links']
const CLICKS_KEY = ['link_clicks']

export function useShortLinks() {
  return useQuery({
    queryKey: LINKS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('short_links').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

// RLS scopes link_clicks to rows whose parent short_link is owned by the
// caller, so a plain select already returns only "my" clicks -- counted
// client-side rather than fighting hand-rolled types for embedded selects.
export function useLinkClickCounts() {
  return useQuery({
    queryKey: CLICKS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('link_clicks').select('short_link_id')
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of data) {
        counts[row.short_link_id] = (counts[row.short_link_id] ?? 0) + 1
      }
      return counts
    },
  })
}

export function useCreateShortLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (link: ShortLinkInsert) => {
      const { data, error } = await supabase.from('short_links').insert(link).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LINKS_KEY }),
  })
}

export function useDeleteShortLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('short_links').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LINKS_KEY }),
  })
}
