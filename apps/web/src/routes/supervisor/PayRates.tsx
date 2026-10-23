import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import WorkerRates, { todayIso } from '@/components/WorkerRates'
import { usd } from '@/components/PaySummary'

interface Worker { id: string; full_name: string; status: string }
interface RateRow { worker_id: string; hourly_rate: number; effective_from: string }

export default function SupervisorPayRates() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // RLS limits both lists to workers in this supervisor's projects.
  const { data: workers, isPending } = useQuery({
    queryKey: ['pay-rate-workers'],
    queryFn: async (): Promise<Worker[]> => {
      const { data } = await supabase
        .from('workers')
        .select('id, full_name, status')
        .neq('status', 'offboarded')
        .order('full_name')
      return (data as Worker[]) ?? []
    },
  })

  const { data: rates } = useQuery({
    queryKey: ['worker-current-rates'],
    queryFn: async (): Promise<RateRow[]> => {
      const { data } = await supabase
        .from('worker_rates')
        .select('worker_id, hourly_rate, effective_from')
        .order('effective_from', { ascending: false })
      return (data as RateRow[]) ?? []
    },
  })

  const current = useMemo(() => {
    const today = todayIso()
    const m = new Map<string, number>()
    for (const r of rates ?? []) {
      if (r.effective_from <= today && !m.has(r.worker_id)) m.set(r.worker_id, Number(r.hourly_rate))
    }
    return m
  }, [rates])

  const shown = (workers ?? []).filter((w) => w.full_name.toLowerCase().includes(search.toLowerCase()))
  const missing = (workers ?? []).filter((w) => !current.has(w.id)).length

  return (
    <RoleScaffold title="Pay rates" backTo="/supervisor/dashboard">
      <input className="input-field" placeholder="Search workers" value={search}
        onChange={(e) => setSearch(e.target.value)} />
      {missing > 0 && (
        <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          {missing} worker{missing === 1 ? '' : 's'} have no rate yet, so their hours show as unpaid.
        </div>
      )}
      {isPending && <p className="text-slate-500">Loading…</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((w) => (
          <li key={w.id} className="rounded-xl bg-white p-3 shadow-sm">
            <button className="flex w-full items-center justify-between text-left"
              onClick={() => setOpenId(openId === w.id ? null : w.id)}>
              <span className="font-semibold">{w.full_name}</span>
              <span className={`text-sm ${current.has(w.id) ? 'text-slate-700' : 'text-amber-700'}`}>
                {current.has(w.id) ? `${usd.format(current.get(w.id)!)}/hr` : 'No rate'} {openId === w.id ? '▲' : '▼'}
              </span>
            </button>
            {openId === w.id && <div className="mt-2"><WorkerRates workerId={w.id} /></div>}
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
