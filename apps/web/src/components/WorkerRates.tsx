import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSupervisor } from '@/hooks/useSupervisor'
import { usd } from './PaySummary'

interface Rate {
  id: string
  hourly_rate: number
  effective_from: string
}

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Effective-dated hourly rates for one worker. A new rate applies from its
 * date onward; earlier days keep whichever rate was in effect then.
 */
export default function WorkerRates({ workerId }: { workerId: string }) {
  const qc = useQueryClient()
  const { supervisor } = useSupervisor()
  const [rate, setRate] = useState('')
  const [from, setFrom] = useState(todayIso())

  const { data: rates, isPending } = useQuery({
    queryKey: ['worker-rates', workerId],
    queryFn: async (): Promise<Rate[]> => {
      const { data, error } = await supabase
        .from('worker_rates')
        .select('id, hourly_rate, effective_from')
        .eq('worker_id', workerId)
        .order('effective_from', { ascending: false })
      if (error) throw error
      return (data as Rate[]) ?? []
    },
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['worker-rates', workerId] })
    qc.invalidateQueries({ queryKey: ['worker-current-rates'] })
    qc.invalidateQueries({ queryKey: ['analytics-pay'] })
    qc.invalidateQueries({ queryKey: ['analytics-daily-attendance'] })
  }

  const add = useMutation({
    mutationFn: async () => {
      const value = Number(rate)
      if (!(value > 0)) throw new Error('Enter an hourly rate above 0')
      if (!from) throw new Error('Pick the date this rate starts')
      // Same start date replaces that entry instead of failing on the unique key.
      const { error } = await supabase
        .from('worker_rates')
        .upsert(
          { worker_id: workerId, hourly_rate: value, effective_from: from, created_by: supervisor?.id ?? null },
          { onConflict: 'worker_id,effective_from' },
        )
      if (error) throw error
    },
    onSuccess: () => {
      setRate('')
      refresh()
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('worker_rates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
  })

  const today = todayIso()
  const currentId = rates?.find((r) => r.effective_from <= today)?.id

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
      <div className="text-sm font-medium text-slate-700">Hourly rate</div>

      {isPending && <div className="text-xs text-slate-500">Loading…</div>}
      {!isPending && rates?.length === 0 && (
        <div className="text-xs text-amber-700">No rate set yet. Hours won't be paid until you add one.</div>
      )}
      {rates && rates.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {rates.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <span>
                <span className="font-medium">{usd.format(Number(r.hourly_rate))}/hr</span>
                <span className="text-slate-500"> from {r.effective_from}</span>
                {r.id === currentId && <span className="ml-1 rounded bg-green-100 px-1 text-xs text-green-800">current</span>}
                {r.effective_from > today && <span className="ml-1 rounded bg-blue-100 px-1 text-xs text-blue-800">upcoming</span>}
              </span>
              <button
                className="text-xs text-red-700"
                disabled={remove.isPending}
                onClick={() => confirm(`Delete the ${usd.format(Number(r.hourly_rate))} rate from ${r.effective_from}?`) && remove.mutate(r.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-slate-600">
          New rate ($/hr)
          <input className="input-field w-28" inputMode="decimal" value={rate}
            onChange={(e) => setRate(e.target.value)} placeholder="e.g. 120" />
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          Applies from
          <input className="input-field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <button className="btn-primary" disabled={add.isPending || !rate} onClick={() => add.mutate()}>
          {add.isPending ? 'Saving…' : 'Add rate'}
        </button>
      </div>
      <div className="text-xs text-slate-500">
        Days before the start date keep the earlier rate.
      </div>
      {(add.error || remove.error) && (
        <div className="text-xs text-red-700">{((add.error ?? remove.error) as Error).message}</div>
      )}
    </div>
  )
}
