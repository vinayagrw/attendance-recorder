import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'

export default function SupervisorReports() {
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })()

  const [startDate, setStartDate] = useState(monthAgo)
  const [endDate, setEndDate] = useState(today)
  const [projectId, setProjectId] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: projects } = useQuery({
    queryKey: ['reports-projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id, name').order('name')
      return (data as Array<{ id: string; name: string }>) ?? []
    },
  })

  const handleDownload = async () => {
    setError(null)
    setDownloading(true)
    try {
      const session = (await supabase.auth.getSession()).data.session
      if (!session) throw new Error('Not signed in')
      const url = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/payroll-export`
      const params = new URLSearchParams({ startDate, endDate })
      if (projectId) params.set('projectId', projectId)
      const res = await fetch(`${url}?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey:
            (import.meta.env.VITE_SUPABASE_ANON_KEY ??
              import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
              '') as string,
        },
      })
      if (res.status === 422) {
        const body = await res.json()
        throw new Error(`Cannot export: ${body.count} unresolved auto-closed shifts in range. Review them first.`)
      }
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `payroll-${startDate}-${endDate}.csv`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <RoleScaffold title="Reports / payroll" backTo="/supervisor/dashboard">
      <p className="text-sm text-slate-600">
        Export attendance as CSV for the selected date range. The export is blocked if any shifts
        are still in <code>auto_closed</code> state — review those first.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">From</span>
        <input type="date" className="input-field" value={startDate}
          onChange={(e) => setStartDate(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">To</span>
        <input type="date" className="input-field" value={endDate}
          onChange={(e) => setEndDate(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Project (optional)</span>
        <select className="input-field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <button onClick={handleDownload} className="btn-primary" disabled={downloading}>
        {downloading ? 'Downloading…' : 'Download CSV'}
      </button>
    </RoleScaffold>
  )
}
