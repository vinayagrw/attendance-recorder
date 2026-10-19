import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type UnitSystem = 'metric' | 'imperial'

const M_PER_MI = 1609.344

/**
 * Org-wide display units (0025). Everything is stored in metres; this only
 * formats values for display and converts the site-radius input.
 */
export function useUnits() {
  const { data } = useQuery({
    queryKey: ['unit-system'],
    queryFn: async (): Promise<UnitSystem> => {
      const { data, error } = await supabase.rpc('get_unit_system')
      if (error) return 'metric'
      return data === 'imperial' ? 'imperial' : 'metric'
    },
    staleTime: 30 * 60 * 1000,
  })
  const system: UnitSystem = data ?? 'metric'
  const imperial = system === 'imperial'

  const formatDistance = (m: number | null | undefined): string => {
    if (m == null || isNaN(m)) return '—'
    if (imperial) {
      const mi = m / M_PER_MI
      return `${mi.toFixed(mi >= 10 ? 0 : mi >= 1 ? 1 : 2)} mi`
    }
    return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`
  }

  const formatSpeed = (ms: number | null | undefined): string => {
    if (ms == null || isNaN(ms)) return '—'
    return imperial ? `${(ms * 2.236936).toFixed(1)} mph` : `${(ms * 3.6).toFixed(1)} km/h`
  }

  return {
    system,
    formatDistance,
    formatSpeed,
    radiusUnit: imperial ? 'mi' : 'm',
    /** Radius typed in the display unit → metres for storage. */
    toMetres: (v: number) => (imperial ? v * M_PER_MI : v),
    /** Stored metres → radius in the display unit (miles to 2 decimals). */
    fromMetres: (m: number) => (imperial ? Math.round((m / M_PER_MI) * 100) / 100 : Math.round(m)),
  }
}
