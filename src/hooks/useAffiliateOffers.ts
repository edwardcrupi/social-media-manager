import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { AffiliateOfferInsert, AffiliateOfferUpdate } from '../types/database'

const KEY = ['affiliate_offers']

// The offer list the generation functions read (Phase 12 Step 1) -- ordered
// the same way they order it, so the top row here is the fallback offer a
// post gets when the model returns no usable offer_id.
export function useAffiliateOffers() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('affiliate_offers')
        .select('*')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useCreateAffiliateOffer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (offer: AffiliateOfferInsert) => {
      const { data, error } = await supabase.from('affiliate_offers').insert(offer).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateAffiliateOffer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...update }: AffiliateOfferUpdate & { id: string }) => {
      const { data, error } = await supabase.from('affiliate_offers').update(update).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteAffiliateOffer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('affiliate_offers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
