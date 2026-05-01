import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import { useWorker } from '@/hooks/useWorker'
import { startSelfieStream, stopStream, captureSelfie } from '@/lib/camera'
import { getCurrentLocation, metersBetween, type PunchLocation } from '@/lib/geolocation'
import { getDeviceInfo } from '@/lib/deviceFingerprint'

export default function WorkerPunch() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { worker, sites, loading } = useWorker()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [siteId, setSiteId] = useState<string>('')
  const [gps, setGps] = useState<PunchLocation | null>(null)
  const [submitting, setSubmitting] = useState<'in' | 'out' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Bounce non-active workers
  useEffect(() => {
    if (loading) return
    if (!worker) return
    if (worker.status === 'pending_approval' || worker.status === 'invited') {
      navigate('/worker/pending', { replace: true })
    } else if (worker.status === 'suspended' || worker.status === 'offboarded') {
      void signOut().then(() => navigate('/worker/login', { replace: true }))
    }
  }, [worker, loading, navigate])

  // Pick the closest site by default (or primary)
  useEffect(() => {
    if (!siteId && sites.length) {
      const primary = sites.find((s) => s.is_primary) ?? sites[0]
      setSiteId(primary.site_id)
    }
  }, [sites, siteId])

  // Camera
  useEffect(() => {
    let cancelled = false
    if (videoRef.current && !streamRef.current) {
      startSelfieStream(videoRef.current)
        .then((s) => {
          if (cancelled) stopStream(s)
          else streamRef.current = s
        })
        .catch((e: Error) => setError(`Camera: ${e.message}`))
    }
    return () => {
      cancelled = true
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [])

  // GPS
  useEffect(() => {
    let active = true
    getCurrentLocation()
      .then((loc) => {
        if (active) setGps(loc)
      })
      .catch(() => {
        /* allow user to still tap, will flag low_gps_accuracy */
      })
    return () => {
      active = false
    }
  }, [])

  const site = useMemo(() => sites.find((s) => s.site_id === siteId) ?? null, [sites, siteId])

  const distanceM = useMemo(() => {
    if (!gps || !site?.default_lat || !site?.default_lng) return null
    return metersBetween(
      { lat: gps.lat, lng: gps.lng },
      { lat: site.default_lat, lng: site.default_lng },
    )
  }, [gps, site])

  // Today's history
  const { data: today } = useQuery({
    queryKey: ['my-attendance-today', worker?.id],
    enabled: !!worker?.id,
    queryFn: async () => {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const { data } = await supabase
        .from('attendance')
        .select('id, type, status, punched_at, distance_from_site_m, flag_reasons')
        .eq('worker_id', worker!.id)
        .gte('punched_at', startOfDay.toISOString())
        .order('punched_at', { ascending: false })
      return data ?? []
    },
  })

  const lastIsIn = today && today.length > 0 && today[0].type === 'in'
  const nextType: 'in' | 'out' = lastIsIn ? 'out' : 'in'

  const handlePunch = async () => {
    setError(null)
    setInfo(null)
    if (!videoRef.current || !worker || !siteId) return setError('Not ready')
    if (!gps) return setError('Waiting for GPS — try again in a moment')

    setSubmitting(nextType)
    try {
      const device = await getDeviceInfo()
      const selfie = await captureSelfie(videoRef.current, {
        timestamp: new Date().toISOString(),
        lat: gps.lat,
        lng: gps.lng,
      })
      const session = (await supabase.auth.getSession()).data.session
      if (!session) throw new Error('No session — please log in again')

      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/punch-submit`
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey:
            (import.meta.env.VITE_SUPABASE_ANON_KEY ??
              import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
              '') as string,
        },
        body: JSON.stringify({
          siteId,
          type: nextType,
          selfieDataUrl: selfie.dataUrl,
          gps: {
            lat: gps.lat,
            lng: gps.lng,
            accuracy_m: gps.accuracyMeters,
            speed_ms: gps.speedMs,
          },
          deviceFingerprint: device.fingerprint,
          userAgent: device.userAgent,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Punch failed (${res.status})`)

      setInfo(
        `Punched ${nextType.toUpperCase()} · status: ${json.status}` +
          (json.flag_reasons?.length ? ` (${json.flag_reasons.join(', ')})` : ''),
      )
      qc.invalidateQueries({ queryKey: ['my-attendance-today'] })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(null)
    }
  }

  if (loading) {
    return <RoleScaffold title="Punch"><p>Loading…</p></RoleScaffold>
  }

  return (
    <RoleScaffold title={worker ? `Hi, ${worker.full_name.split(' ')[0]}` : 'Punch'} backTo="/">
      {site?.daily_note && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="mb-1 font-semibold">Today's briefing — {site.name}</div>
          <div>{site.daily_note}</div>
        </div>
      )}

      <select
        className="input-field"
        value={siteId}
        onChange={(e) => setSiteId(e.target.value)}
      >
        {sites.map((s) => (
          <option key={s.site_id} value={s.site_id}>
            {s.name}
            {s.is_primary ? ' (primary)' : ''}
          </option>
        ))}
      </select>

      <div className="overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="w-full" playsInline muted />
      </div>

      <div className="rounded-xl bg-white p-3 text-sm shadow-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">GPS</span>
          <span className="font-mono">
            {gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'pending…'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Accuracy</span>
          <span className="font-mono">{gps ? `${gps.accuracyMeters.toFixed(0)} m` : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Distance to site</span>
          <span className="font-mono">{distanceM != null ? `${distanceM.toFixed(0)} m` : '—'}</span>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>}

      <button
        type="button"
        className="btn-primary"
        onClick={handlePunch}
        disabled={!!submitting || !worker || !siteId}
      >
        {submitting ? `Submitting ${submitting.toUpperCase()}…` : `Punch ${nextType.toUpperCase()}`}
      </button>

      <button
        type="button"
        className="btn-secondary"
        onClick={() => navigate('/worker/history')}
      >
        My history
      </button>

      <button
        type="button"
        className="text-sm text-slate-500 underline"
        onClick={async () => {
          await signOut()
          navigate('/worker/login', { replace: true })
        }}
      >
        Sign out
      </button>
    </RoleScaffold>
  )
}
