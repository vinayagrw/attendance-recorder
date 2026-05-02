import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

// Shared filter shape consumed by every analytics RPC. All optional —
// undefined / null means "no filter on this column".
export interface AnalyticsFilters {
  startDate: string         // ISO yyyy-mm-dd
  endDate: string           // ISO yyyy-mm-dd
  projectId?: string | null
  siteId?: string | null
  workerId?: string | null
  statuses?: string[] | null
}

const HOURS_DEFAULT_STATUSES = ['verified', 'auto_closed']
const DAILY_DEFAULT_STATUSES = ['verified', 'auto_closed', 'flagged', 'pending']

function rangeToTimestamps(startDate: string, endDate: string) {
  return {
    p_start: new Date(`${startDate}T00:00:00`).toISOString(),
    p_end: new Date(`${endDate}T23:59:59`).toISOString(),
  }
}

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
  hours_worked: number | null
  status: string
  flag_reasons: string[]
}

export interface FilterOptions {
  sites: Array<{ id: string; name: string; project_id: string }>
  workers: Array<{ id: string; full_name: string; status: string }>
}

// ─────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────

export function useAnalyticsHoursPerProject(filters: AnalyticsFilters, enabled = true) {
  const { startDate, endDate, projectId, siteId, workerId, statuses } = filters
  return useQuery({
    queryKey: ['analytics-hours-per-project', startDate, endDate, projectId, siteId, workerId, statuses],
    enabled,
    queryFn: async (): Promise<HoursPerProject[]> => {
      const { data, error } = await supabase.rpc('analytics_hours_per_project', {
        ...rangeToTimestamps(startDate, endDate),
        p_project_id: projectId ?? null,
        p_site_id: siteId ?? null,
        p_worker_id: workerId ?? null,
        p_statuses: statuses ?? HOURS_DEFAULT_STATUSES,
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

export function useAnalyticsHoursPerWorkerProject(filters: AnalyticsFilters, enabled = true) {
  const { startDate, endDate, projectId, siteId, workerId, statuses } = filters
  return useQuery({
    queryKey: ['analytics-hours-per-worker-project', startDate, endDate, projectId, siteId, workerId, statuses],
    enabled,
    queryFn: async (): Promise<HoursPerWorkerProject[]> => {
      const { data, error } = await supabase.rpc('analytics_hours_per_worker_project', {
        ...rangeToTimestamps(startDate, endDate),
        p_project_id: projectId ?? null,
        p_site_id: siteId ?? null,
        p_worker_id: workerId ?? null,
        p_statuses: statuses ?? HOURS_DEFAULT_STATUSES,
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

export function useAnalyticsWorkerCountPerProject(
  filters: Pick<AnalyticsFilters, 'projectId' | 'siteId'>,
  enabled = true,
) {
  const { projectId, siteId } = filters
  return useQuery({
    queryKey: ['analytics-worker-count-per-project', projectId, siteId],
    enabled,
    queryFn: async (): Promise<WorkerCountPerProject[]> => {
      const { data, error } = await supabase.rpc('analytics_worker_count_per_project', {
        p_project_id: projectId ?? null,
        p_site_id: siteId ?? null,
      })
      if (error) {
        logger.error(error, { module: 'useAnalyticsWorkerCountPerProject' })
        throw error
      }
      return (data as WorkerCountPerProject[]) ?? []
    },
    staleTime: 10 * 60 * 1000,
  })
}

export function useAnalyticsDailyAttendance(filters: AnalyticsFilters, enabled = true) {
  const { startDate, endDate, projectId, siteId, workerId, statuses } = filters
  return useQuery({
    queryKey: ['analytics-daily-attendance', startDate, endDate, projectId, siteId, workerId, statuses],
    enabled,
    queryFn: async (): Promise<DailyAttendance[]> => {
      const { data, error } = await supabase.rpc('analytics_daily_attendance', {
        ...rangeToTimestamps(startDate, endDate),
        p_project_id: projectId ?? null,
        p_site_id: siteId ?? null,
        p_worker_id: workerId ?? null,
        p_statuses: statuses ?? DAILY_DEFAULT_STATUSES,
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

/**
 * Site + worker dropdown options for the analytics filters. Optionally
 * narrowed to a single project so the worker list reflects the current
 * project's assignments.
 */
export function useAttendanceFilterOptions(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['attendance-filter-options', projectId],
    enabled,
    queryFn: async (): Promise<FilterOptions> => {
      const { data, error } = await supabase.rpc('attendance_filter_options', {
        p_project_id: projectId ?? null,
      })
      if (error) {
        logger.error(error, { module: 'useAttendanceFilterOptions' })
        throw error
      }
      const row = (data as Array<FilterOptions> | null)?.[0]
      return row ?? { sites: [], workers: [] }
    },
    staleTime: 5 * 60 * 1000,
  })
}
