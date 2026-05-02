import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { APP_CONFIG } from '@/config/app'

export interface AttendanceRow {
  id: string
  worker_id: string
  site_id: string
  type: 'in' | 'out'
  status: string
  punched_at: string
  device_lat: number | null
  device_lng: number | null
  gps_accuracy_m: number | null
  speed_ms: number | null
  distance_from_site_m: number | null
  selfie_url: string | null
  flag_reasons: string[]
  reviewer_comment: string | null
  device_fingerprint: string | null
  user_agent: string | null
  ip_address: string | null
  selfie_metadata: Record<string, unknown> | null
  capture_method: string | null
  workers?: { full_name: string } | null
  sites?: { name: string } | null
}

export function useTodayAttendance() {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['attendance-today'],
    queryFn: async (): Promise<AttendanceRow[]> => {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const { data, error } = await supabase
        .from('attendance')
        .select(
          'id, worker_id, site_id, type, status, punched_at, device_lat, device_lng, ' +
            'gps_accuracy_m, speed_ms, distance_from_site_m, selfie_url, flag_reasons, ' +
            'reviewer_comment, device_fingerprint, user_agent, ip_address, ' +
            'selfie_metadata, capture_method, ' +
            'workers (full_name), sites (name)',
        )
        .gte('punched_at', startOfDay.toISOString())
        .order('punched_at', { ascending: false })
      if (error) throw error
      return (data as unknown as AttendanceRow[]) ?? []
    },
    refetchInterval: APP_CONFIG.ATTENDANCE_REFETCH_MS,
  })

  useEffect(() => {
    const channel = supabase
      .channel('attendance-today')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance' },
        () => {
          qc.invalidateQueries({ queryKey: ['attendance-today'] })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [qc])

  return query
}
