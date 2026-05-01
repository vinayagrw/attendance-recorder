import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSession } from './useSession'

export interface Worker {
  id: string
  full_name: string
  status: 'invited' | 'pending_approval' | 'active' | 'suspended' | 'offboarded'
  auth_user_id: string | null
  baseline_selfie_url: string | null
}

export interface WorkerSite {
  site_id: string
  name: string
  default_lat: number | null
  default_lng: number | null
  default_radius_m: number | null
  timezone: string
  daily_note: string | null
  project_id: string
  project_name?: string
  is_primary: boolean
  is_assigned?: boolean
}

export function useWorker() {
  const { session, loading: sessionLoading } = useSession()
  const userId = session?.user?.id ?? null

  const workerQuery = useQuery({
    queryKey: ['my-worker', userId],
    enabled: !!userId,
    queryFn: async (): Promise<Worker | null> => {
      const { data, error } = await supabase
        .from('workers')
        .select('id, full_name, status, auth_user_id, baseline_selfie_url')
        .eq('auth_user_id', userId!)
        .maybeSingle()
      if (error) throw error
      return (data as Worker | null) ?? null
    },
  })

  const sitesQuery = useQuery({
    queryKey: ['my-assignable-sites', workerQuery.data?.id],
    enabled: !!workerQuery.data?.id,
    queryFn: async (): Promise<WorkerSite[]> => {
      // M13: returns ALL active sites with is_assigned flag, so workers can
      // punch at unassigned sites (will be flagged as `site_not_assigned`
      // server-side for supervisor review).
      const { data, error } = await supabase.rpc('list_assignable_sites', {
        p_worker_id: workerQuery.data!.id,
      })
      if (error) throw error
      return (data as WorkerSite[]) ?? []
    },
  })

  return {
    worker: workerQuery.data ?? null,
    sites: sitesQuery.data ?? [],
    loading: sessionLoading || workerQuery.isPending,
    isLoggedIn: !!session,
  }
}

export function workerEmail(workerId: string) {
  return `${workerId}@worker.local`
}

export function workerPassword(pin: string, workerId: string) {
  return `${pin}-${workerId.slice(0, 8)}`
}
