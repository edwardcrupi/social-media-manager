import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { PostInsert, PostUpdate } from '../types/database'

const KEY = ['posts']

// Deliberately unpaginated. Overview, Insights and Revenue all count and
// filter across the whole set, so capping this would silently skew every
// number on those pages rather than showing an obvious truncation. The
// Content Queue, which is the only page that renders a row per post, limits
// what it draws instead -- see ContentQueuePage.
//
// This does have a ceiling: PostgREST caps a response at 1000 rows, and at
// a few posts a day that is roughly a year out. Past that, these pages need
// real aggregate queries rather than a bigger fetch.
export function usePosts() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .order('scheduled_for', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data
    },
  })
}

export function useCreatePost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (post: PostInsert) => {
      const { data, error } = await supabase.from('posts').insert(post).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdatePost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: PostUpdate }) => {
      const { data, error } = await supabase
        .from('posts')
        .update(update)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeletePost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('posts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
