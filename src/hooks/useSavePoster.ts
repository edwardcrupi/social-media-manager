import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queuePosterCapture } from '../lib/posterCapture'

// Captures a poster frame for a video post and stores it, so the queue stops
// downloading the video itself to draw a thumbnail. Backfill only: it runs
// once per uploaded video and the result is reused by every post row sharing
// that video. See supabase/functions/save-poster/index.ts.
export function useSavePoster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ postId, mediaUrl }: { postId: string; mediaUrl: string }) => {
      const posterBase64 = await queuePosterCapture(mediaUrl)
      const { data, error } = await supabase.functions.invoke<{ posterUrl: string }>('save-poster', {
        body: { postId, posterBase64 },
      })
      if (error) throw error
      if (!data?.posterUrl) throw new Error('save-poster returned no posterUrl')
      return data.posterUrl
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['posts'] }),
  })
}
