import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useFeatureFlag(key: string) {
  const { data: flag, isPending } = useQuery({
    queryKey: ['feature-flag', key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', key)
        .maybeSingle()
      if (error) throw error
      return data?.enabled ?? false
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  return {
    enabled: flag ?? false,
    loading: isPending,
  }
}

export function useAllFeatureFlags() {
  const { data: flags, isPending } = useQuery({
    queryKey: ['all-feature-flags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feature_flags')
        .select('key, enabled, name, description')
        .order('name')
      if (error) throw error
      return (
        data as Array<{
          key: string
          enabled: boolean
          name: string
          description: string | null
        }>
      ) ?? []
    },
    staleTime: 5 * 60 * 1000,
  })

  return {
    flags: flags ?? [],
    loading: isPending,
  }
}

