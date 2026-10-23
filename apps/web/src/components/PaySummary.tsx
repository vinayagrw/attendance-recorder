import { useMemo, useState } from 'react'
import type { PayRow } from '@/hooks/useAnalytics'

export const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

interface Group {
  key: string
  name: string
  hours: number
  amount: number
  unratedHours: number
}

type Dim = 'worker' | 'project' | 'site'
type SortKey = 'name' | 'hours' | 'amount'

const DIMS: Array<{ key: Dim; label: string }> = [
  { key: 'worker', label: 'By worker' },
  { key: 'project', label: 'By project' },
  { key: 'site', label: 'By site' },
]

function groupBy(rows: PayRow[], dim: Dim): Group[] {
  const map = new Map<string, Group>()
  for (const r of rows) {
    const key = dim === 'worker' ? r.worker_id : dim === 'project' ? r.project_id : r.site_id
    const name = dim === 'worker' ? r.worker_name : dim === 'project' ? r.project_name : `${r.site_name} (${r.project_name})`
    const g = map.get(key) ?? { key, name, hours: 0, amount: 0, unratedHours: 0 }
    const h = Number(r.hours)
    g.hours += h
    if (r.amount == null) g.unratedHours += h
    else g.amount += Number(r.amount)
    map.set(key, g)
  }
  return [...map.values()]
}

export default function PaySummary({ rows, loading }: { rows: PayRow[]; loading: boolean }) {
  const [dim, setDim] = useState<Dim>('worker')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'amount', desc: true })

  const totals = useMemo(() => {
    let hours = 0, amount = 0, unrated = 0
    for (const r of rows) {
      const h = Number(r.hours)
      hours += h
      if (r.amount == null) unrated += h
      else amount += Number(r.amount)
    }
    return { hours, amount, unrated }
  }, [rows])

  const groups = useMemo(() => {
    const g = groupBy(rows, dim)
    const dir = sort.desc ? -1 : 1
    return g.sort((a, b) =>
      sort.key === 'name' ? dir * a.name.localeCompare(b.name) : dir * (a[sort.key] - b[sort.key]))
  }, [rows, dim, sort])

  const th = (key: SortKey, label: string, right = false) => (
    <th
      className={`px-3 py-2 font-semibold text-slate-700 cursor-pointer select-none ${right ? 'text-right' : 'text-left'}`}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}
    >
      {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  )

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-700">💰 Pay</h2>
        <div className="flex gap-1">
          {DIMS.map((d) => (
            <button
              key={d.key}
              onClick={() => setDim(d.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${dim === d.key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 p-4">
        <Tile label="Total pay" value={usd.format(totals.amount)} />
        <Tile label="Paid hours" value={(totals.hours - totals.unrated).toFixed(2)} />
        <Tile
          label="Hours with no rate"
          value={totals.unrated.toFixed(2)}
          warn={totals.unrated > 0}
        />
      </div>

      {loading && <div className="p-4 text-center text-sm text-slate-500">Loading…</div>}
      {!loading && rows.length === 0 && (
        <div className="p-4 text-center text-sm text-slate-500">No completed shifts in this range.</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {th('name', DIMS.find((d) => d.key === dim)!.label.replace('By ', '').replace(/^./, (c) => c.toUpperCase()))}
                {th('hours', 'Hours', true)}
                {th('amount', 'Amount', true)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, idx) => (
                <tr key={g.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-3 py-2 font-medium text-slate-700">{g.name}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{g.hours.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {usd.format(g.amount)}
                    {g.unratedHours > 0 && (
                      <span className="ml-1 text-amber-700" title="Some hours have no rate set">
                        +{g.unratedHours.toFixed(2)}h unrated
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
              <tr>
                <td className="px-3 py-2 text-slate-700">Total</td>
                <td className="px-3 py-2 text-right text-slate-700">{totals.hours.toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-slate-700">{usd.format(totals.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${warn ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${warn ? 'text-amber-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  )
}
