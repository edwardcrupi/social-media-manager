import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { RevenueEventInsert } from '../types/database'

const KEY = ['revenue_events']

export function useRevenueEvents() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('revenue_events')
        .select('*')
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useCreateRevenueEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (event: RevenueEventInsert) => {
      const { data, error } = await supabase
        .from('revenue_events')
        .insert(event)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteRevenueEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('revenue_events').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
