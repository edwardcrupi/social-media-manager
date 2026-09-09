import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { AutomationSettingsUpdate } from '../types/database'

const KEY = ['automation_settings']

export function useAutomationSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('automation_settings').select('*').maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useSaveAutomationSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (update: AutomationSettingsUpdate) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      const { data, error } = await supabase
        .from('automation_settings')
        .upsert({ user_id: user.id, ...update }, { onConflict: 'user_id' })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
