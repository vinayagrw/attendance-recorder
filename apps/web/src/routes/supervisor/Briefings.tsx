import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { useSupervisor } from '@/hooks/useSupervisor'
import { logger } from '@/lib/logger'

interface SiteWithBriefing {
  id: string
  name: string
  daily_note: string | null
  daily_note_updated_at: string | null
  status: string
  projects?: { name: string } | null
}

export default function SupervisorBriefings() {
  const qc = useQueryClient()
  const { supervisor } = useSupervisor()

  const { data: sites, isPending } = useQuery({
    queryKey: ['briefing-sites'],
    queryFn: async (): Promise<SiteWithBriefing[]> => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, name, daily_note, daily_note_updated_at, status, projects(name)')
        .eq('status', 'active')
        .order('name')
      if (error) throw error
      return (data as unknown as SiteWithBriefing[]) ?? []
    },
  })

  const updateNote = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase
        .from('sites')
        .update({
          daily_note: note || null,
          daily_note_updated_at: new Date().toISOString(),
          daily_note_updated_by: supervisor?.id ?? null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['briefing-sites'] })
    },
    onError: (e) => logger.error(e, { module: 'Briefings', action: 'updateNote' }),
  })

  return (
    <RoleScaffold title="Site briefings" backTo="/supervisor/dashboard">
      <p className="text-sm text-slate-600">
        Edit the daily briefing for each active site. Workers see this above the Punch button
        and must acknowledge before punching in.
      </p>

      {isPending && <p className="text-slate-500">Loading…</p>}
      {sites && sites.length === 0 && (
        <p className="text-sm text-slate-500">No active sites in your scope.</p>
      )}

      <ul className="flex flex-col gap-3">
        {(sites ?? []).map((s) => (
          <li key={s.id} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{s.name}</span>
              <span className="text-xs text-slate-400">
                {s.daily_note_updated_at
                  ? `updated ${new Date(s.daily_note_updated_at).toLocaleString()}`
                  : 'never updated'}
              </span>
            </div>
            <div className="text-xs text-slate-500">{s.projects?.name ?? '—'}</div>
            <textarea
              className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-sm"
              rows={3}
              placeholder="Today's briefing — site opens at…, safety reminders, blockers, etc."
              defaultValue={s.daily_note ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (s.daily_note ?? '')) {
                  updateNote.mutate({ id: s.id, note: e.target.value })
                }
              }}
            />
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
