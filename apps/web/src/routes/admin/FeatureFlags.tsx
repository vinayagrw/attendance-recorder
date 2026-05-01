import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { useAllFeatureFlags } from '@/hooks/useFeatureFlag'
import { logger } from '@/lib/logger'

export default function AdminFeatureFlags() {
  const qc = useQueryClient()
  const { flags, loading } = useAllFeatureFlags()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const toggleFlag = useMutation({
    mutationFn: async (key: string) => {
      const flag = flags.find((f) => f.key === key)
      if (!flag) throw new Error('Flag not found')

      const { error: err } = await supabase
        .from('feature_flags')
        .update({ enabled: !flag.enabled, updated_at: new Date().toISOString() })
        .eq('key', key)

      if (err) throw err
      return key
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-feature-flags'] })
      qc.invalidateQueries({ queryKey: ['feature-flag'] })
      setSuccess('Feature flag updated')
      setTimeout(() => setSuccess(null), 3000)
    },
    onError: (e: Error) => {
      logger.error(e, { module: 'AdminFeatureFlags', action: 'toggle' })
      setError(e.message)
      setTimeout(() => setError(null), 5000)
    },
  })

  return (
    <RoleScaffold title="Feature Flags" backTo="/admin/projects">
      <p className="mb-4 text-sm text-slate-600">
        Control feature visibility and gradual rollouts. Changes take effect immediately.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {success && (
        <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</div>
      )}

      {loading && <p className="text-sm text-slate-500">Loading flags…</p>}

      {!loading && flags.length === 0 && (
        <div className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-600">
          No feature flags found. Create some in the database.
        </div>
      )}

      {!loading && flags.length > 0 && (
        <div className="space-y-3">
          {flags.map((flag) => (
            <div
              key={flag.key}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900">{flag.name}</h3>
                  {flag.description && (
                    <p className="mt-1 text-sm text-slate-600">{flag.description}</p>
                  )}
                  <p className="mt-2 text-xs font-mono text-slate-500">{flag.key}</p>
                </div>

                <button
                  onClick={() => toggleFlag.mutate(flag.key)}
                  disabled={toggleFlag.isPending}
                  className={`ml-4 shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                    flag.enabled
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {flag.enabled ? '✓ Enabled' : '○ Disabled'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </RoleScaffold>
  )
}

