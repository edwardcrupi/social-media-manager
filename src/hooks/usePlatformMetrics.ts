import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const KEY = ['platform_metrics']

// Read-only: rows are written only by sync-instagram-insights (service_role).
export function usePlatformMetrics() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_metrics')
        .select('*')
        .order('metric_date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}
