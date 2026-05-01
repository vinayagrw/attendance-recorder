import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface HoursPerProject {
  project_id: string
  project_name: string
  total_hours: number
  punch_count: number
  worker_count: number
}

export interface HoursPerWorkerProject {
  project_id: string
  project_name: string
  worker_id: string
  worker_name: string
  total_hours: number
  punch_count: number
  days_worked: number
}

export interface WorkerCountPerProject {
  project_id: string
  project_name: string
  active_workers: number
  total_workers: number
}

export interface DailyAttendance {
  attendance_date: string
  project_id: string
  project_name: string
  site_id: string
  site_name: string
  worker_id: string
  worker_name: string
  punch_in_time: string
  punch_out_time: string | null
  hours_worked: number
  status: string
  flag_reasons: string[]
}

export function useAnalyticsHoursPerProject(
  startDate: string,
  endDate: string,
  enabled: boolean = true,
) {
  const startTs = new Date(`${startDate}T00:00:00`).toISOString()
  const endTs = new Date(`${endDate}T23:59:59`).toISOString()

  return useQuery({
    queryKey: ['analytics-hours-per-project', startDate, endDate],
    enabled,
    queryFn: async (): Promise<HoursPerProject[]> => {
      const { data, error } = await supabase.rpc('analytics_hours_per_project', {
        p_start: startTs,
        p_end: endTs,
      })
      if (error) {
        logger.error(error, { module: 'useAnalyticsHoursPerProject' })
        throw error
      }
      return (data as HoursPerProject[]) ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useAnalyticsHoursPerWorkerProject(
  startDate: string,
  endDate: string,
  projectId: string | null,
  enabled: boolean = true,
) {
  const startTs = new Date(`${startDate}T00:00:00`).toISOString()
  const endTs = new Date(`${endDate}T23:59:59`).toISOString()

  return useQuery({
    queryKey: ['analytics-hours-per-worker-project', startDate, endDate, projectId],
    enabled,
    queryFn: async (): Promise<HoursPerWorkerProject[]> => {
      const { data, error } = await supabase.rpc('analytics_hours_per_worker_project', {
        p_start: startTs,
        p_end: endTs,
        p_project_id: projectId,
      })
      if (error) {
        logger.error(error, { module: 'useAnalyticsHoursPerWorkerProject' })
        throw error
      }
      return (data as HoursPerWorkerProject[]) ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useAnalyticsWorkerCountPerProject(enabled: boolean = true) {
  return useQuery({
    queryKey: ['analytics-worker-count-per-project'],
    enabled,
    queryFn: async (): Promise<WorkerCountPerProject[]> => {
      const { data, error } = await supabase.rpc('analytics_worker_count_per_project')
      if (error) {
        logger.error(error, { module: 'useAnalyticsWorkerCountPerProject' })
        throw error
      }
      return (data as WorkerCountPerProject[]) ?? []
    },
    staleTime: 10 * 60 * 1000,
  })
}

export function useAnalyticsDailyAttendance(
  startDate: string,
  endDate: string,
  projectId: string | null,
  enabled: boolean = true,
) {
  const startTs = new Date(`${startDate}T00:00:00`).toISOString()
  const endTs = new Date(`${endDate}T23:59:59`).toISOString()

  return useQuery({
    queryKey: ['analytics-daily-attendance', startDate, endDate, projectId],
    enabled,
    queryFn: async (): Promise<DailyAttendance[]> => {
      const { data, error } = await supabase.rpc('analytics_daily_attendance', {
        p_start: startTs,
        p_end: endTs,
        p_project_id: projectId,
      })
      if (error) {
        logger.error(error, { module: 'useAnalyticsDailyAttendance' })
        throw error
      }
      return (data as DailyAttendance[]) ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
}

