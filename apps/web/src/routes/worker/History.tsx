import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { useWorker } from '@/hooks/useWorker'

const STATUS_BADGE: Record<string, string> = {
  verified: 'bg-green-100 text-green-800',
  pending: 'bg-slate-100 text-slate-700',
  flagged: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-700',
  auto_closed: 'bg-purple-100 text-purple-800',
}

export default function WorkerHistory() {
  const { worker } = useWorker()

  const { data, isPending } = useQuery({
    queryKey: ['my-attendance-7d', worker?.id],
    enabled: !!worker?.id,
    queryFn: async () => {
      const since = new Date()
      since.setDate(since.getDate() - 7)
      const { data } = await supabase
        .from('attendance')
        .select('id, type, status, punched_at, distance_from_site_m, flag_reasons')
        .eq('worker_id', worker!.id)
        .gte('punched_at', since.toISOString())
        .order('punched_at', { ascending: false })
      return data ?? []
    },
  })

  return (
    <RoleScaffold title="My attendance" backTo="/worker/punch">
      {isPending && <p className="text-slate-500">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-slate-500">No punches in the last 7 days.</p>
      )}
      <ul className="flex flex-col gap-2">
        {(data ?? []).map((row) => {
          const dt = new Date(row.punched_at)
          return (
            <li key={row.id} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-slate-500">
                  {dt.toLocaleDateString()} · {dt.toLocaleTimeString()}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_BADGE[row.status] ?? 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {row.status}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="font-semibold uppercase">{row.type}</span>
                <span className="text-slate-500">
                  {row.distance_from_site_m != null
                    ? `${row.distance_from_site_m.toFixed(0)} m from site`
                    : ''}
                </span>
              </div>
              {row.flag_reasons?.length > 0 && (
                <div className="mt-1 text-xs text-amber-700">
                  ⚠ {row.flag_reasons.join(', ')}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </RoleScaffold>
  )
}
