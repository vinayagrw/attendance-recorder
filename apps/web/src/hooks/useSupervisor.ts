import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSession } from './useSession'

export interface Supervisor {
  id: string
  full_name: string
  role: 'admin' | 'supervisor'
  scope_project_ids: string[]
}

export function useSupervisor() {
  const { session, loading: sessionLoading } = useSession()
  const userId = session?.user?.id ?? null

  const query = useQuery({
    queryKey: ['supervisor', userId],
    enabled: !!userId,
    queryFn: async (): Promise<Supervisor | null> => {
      const { data, error } = await supabase
        .from('supervisors')
        .select('id, full_name, role, scope_project_ids')
        .eq('id', userId!)
        .maybeSingle()
      if (error) throw error
      return (data as Supervisor | null) ?? null
    },
  })

  return {
    supervisor: query.data ?? null,
    loading: sessionLoading || (!!userId && query.isPending),
    error: query.error,
    isLoggedIn: !!session,
  }
}
