import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { SocialProfileInsert, SocialProfileUpdate } from '../types/database'

const KEY = ['social_profiles']

export function useSocialProfiles() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('social_profiles')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
  })
}

export function useCreateSocialProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (profile: SocialProfileInsert) => {
      const { data, error } = await supabase
        .from('social_profiles')
        .insert(profile)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateSocialProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: SocialProfileUpdate }) => {
      const { data, error } = await supabase
        .from('social_profiles')
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

export function useDeleteSocialProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('social_profiles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
