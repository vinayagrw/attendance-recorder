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
import { getDigitalFootprintJSON } from '@/lib/digitalFootprint'
import { drainQueue, enqueuePunch, queueLength } from '@/lib/offlineQueue'
import { logger } from '@/lib/logger'

interface PunchPayload {
  siteId: string
  type: 'in' | 'out'
  selfieDataUrl: string
  gps: { lat: number; lng: number; accuracy_m: number; speed_ms: number | null }
  deviceFingerprint: string
  userAgent: string
  acknowledgedBriefingId?: string | null
  // M15 — richer evidence for supervisor review
  selfieMetadata?: Record<string, unknown>
  selfieSha256?: string | null
  captureMethod?: string
}

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
  const [briefingAck, setBriefingAck] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [queued, setQueued] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraTick, setCameraTick] = useState(0) // bump to retry stream

  // Bounce non-active workers
  useEffect(() => {
    if (loading || !worker) return
    if (worker.status === 'pending_approval' || worker.status === 'invited') {
      navigate('/worker/pending', { replace: true })
    } else if (worker.status === 'suspended' || worker.status === 'offboarded') {
      void signOut().then(() => navigate('/worker/login', { replace: true }))
    }
  }, [worker, loading, navigate])

  // Online / offline listeners + queue drain on reconnect
  useEffect(() => {
    const refreshQueue = () => void queueLength().then(setQueued)
    refreshQueue()
    const onOnline = () => {
      setOnline(true)
      void drainQueue<PunchPayload>(async (p) => {
        try {
          const { ok } = await postPunch(p)
          return { ok }
        } catch {
          return { ok: false }
        }
      }).then(({ drained }) => {
        if (drained > 0) {
          setInfo(`Synced ${drained} queued punch(es).`)
          qc.invalidateQueries({ queryKey: ['my-attendance-today'] })
        }
        refreshQueue()
      })
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [qc])

  // Auto-pick primary or nearest site
  useEffect(() => {
    if (!siteId && sites.length) {
      const primary = sites.find((s) => s.is_primary) ?? sites[0]
      setSiteId(primary.site_id)
    }
  }, [sites, siteId])

  // Camera — gated by `cameraTick` so a Retry button can re-trigger
  useEffect(() => {
    let cancelled = false
    setCameraReady(false)
    const videoEl = videoRef.current
    if (videoEl && !streamRef.current) {
      startSelfieStream(videoEl)
        .then((s) => {
          if (cancelled) {
            stopStream(s, videoEl)
            return
          }
          streamRef.current = s
          setCameraReady(true)
          setError(null)
        })
        .catch((e: Error) => {
          // AbortError is benign — the cleanup tore us down before play()
          // resolved. Don't surface it to the user.
          if (e.name === 'AbortError') return
          logger.error(e, { module: 'WorkerPunch', action: 'startSelfieStream', workerId: worker?.id })
          setError(`Camera: ${e.message}`)
        })
    }
    return () => {
      cancelled = true
      stopStream(streamRef.current, videoEl)
      streamRef.current = null
    }
    // worker?.id deliberately excluded so we don't restart the stream on auth state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraTick])

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

  // Today's briefing comes from sites.daily_note (already loaded by useWorker
  // via the worker_my_sites view). The site_briefings history table is a
  // post-MVP enhancement — see docs/feat-site-of-day-briefing.md.
  // We use the site_id as a stable "briefing id" so the punch-submit Edge
  // Function records *which* note was acknowledged.
  const briefing = site?.daily_note
    ? { id: `${siteId}:${site.daily_note.length}`, note: site.daily_note }
    : null

  // Reset ack when site or briefing changes
  useEffect(() => setBriefingAck(false), [siteId, briefing?.id])

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

  // Briefing must be acknowledged for IN punches; OUT punches always allowed
  const briefingGate = nextType === 'in' && !!briefing && !briefingAck

  const handlePunch = async () => {
    setError(null)
    setInfo(null)
    if (!videoRef.current || !worker || !siteId) return setError('Not ready')
    if (!cameraReady) return setError('Camera still warming up — wait a moment and try again')
    if (!gps) return setError('Waiting for GPS — try again in a moment')
    if (briefingGate) return setError('Read and acknowledge the briefing first')

    setSubmitting(nextType)
    try {
      const device = await getDeviceInfo()
      const selfie = await captureSelfie(videoRef.current, {
        timestamp: new Date().toISOString(),
        lat: gps.lat,
        lng: gps.lng,
      })
      const footprint = getDigitalFootprintJSON()
      const payload: PunchPayload = {
        siteId,
        type: nextType,
        selfieDataUrl: selfie.dataUrl,
        gps: { lat: gps.lat, lng: gps.lng, accuracy_m: gps.accuracyMeters, speed_ms: gps.speedMs },
        deviceFingerprint: device.fingerprint,
        userAgent: device.userAgent,
        acknowledgedBriefingId: briefing?.id ?? null,
        captureMethod: 'camera',
        selfieSha256: selfie.sha256,
        selfieMetadata: {
          image: {
            widthPx: selfie.widthPx,
            heightPx: selfie.heightPx,
            byteSize: selfie.byteSize,
            mimeType: selfie.mimeType,
            sha256: selfie.sha256,
            captureMs: selfie.captureMs,
            watermarked: selfie.watermarked,
          },
          camera: selfie.cameraTrack,
          device: footprint,
        },
      }

      try {
        const result = await postPunch(payload)
        if (!result.ok) {
          // Server reachable but rejected the punch — surface the error
          // directly so the worker can fix it (or call the supervisor).
          // Don't queue: re-trying the same bad payload will keep failing.
          throw new ServerRejected(result.json.error ?? 'Punch failed')
        }
        const { json } = result
        logger.info('punch submitted', {
          module: 'WorkerPunch',
          action: 'submit',
          workerId: worker.id,
          siteId,
          attendanceId: json.id,
          type: nextType,
          status: json.status,
        })
        setInfo(
          `Punched ${nextType.toUpperCase()} · status: ${json.status}` +
            (json.flag_reasons?.length ? ` (${json.flag_reasons.join(', ')})` : ''),
        )
        qc.invalidateQueries({ queryKey: ['my-attendance-today'] })
      } catch (e) {
        if (e instanceof ServerRejected) {
          logger.error(e, {
            module: 'WorkerPunch',
            action: 'submit-rejected',
            workerId: worker.id,
            siteId,
          })
          setError(e.message)
          return
        }
        // Genuine connectivity failure (TypeError from fetch, AbortError, etc.)
        // — queue for later sync.
        logger.warn('punch failed — enqueuing offline', {
          module: 'WorkerPunch',
          action: 'enqueue',
          workerId: worker.id,
          siteId,
          reason: (e as Error).message,
        })
        await enqueuePunch(payload)
        setQueued(await queueLength())
        setInfo(`Network unavailable — punch queued. Will sync when online. (${(e as Error).message})`)
      }
    } catch (e) {
      logger.error(e, {
        module: 'WorkerPunch',
        action: 'submit',
        workerId: worker?.id,
        siteId,
        type: nextType,
      })
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
      {!online && (
        <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
          Offline — punches will queue and sync automatically.
        </div>
      )}
      {queued > 0 && (
        <div className="rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
          {queued} punch(es) queued for sync.
        </div>
      )}

      {briefing && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="mb-1 font-semibold">Today's briefing — {site?.name}</div>
          <div className="whitespace-pre-line">{briefing.note}</div>
          {nextType === 'in' && (
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={briefingAck}
                onChange={(e) => setBriefingAck(e.target.checked)}
                className="h-5 w-5"
              />
              <span>I have read today's briefing</span>
            </label>
          )}
        </div>
      )}

      <div>
        <select
          className="input-field"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
        >
          {sites.map((s) => (
            <option key={s.site_id} value={s.site_id}>
              {s.is_assigned === false ? '⚠ ' : ''}
              {s.name}
              {s.is_primary ? ' ★' : ''}
              {s.is_assigned === false ? ' (not assigned to you)' : ''}
            </option>
          ))}
        </select>
        {site && site.is_assigned === false && (
          <p className="mt-1 text-xs text-amber-700">
            ⚠ You aren't assigned to this site. Your punch will go through but will be flagged
            for supervisor review.
          </p>
        )}
      </div>

      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="w-full" playsInline muted />
        {!cameraReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-white">
            <div className="text-sm">Warming up camera…</div>
            <button
              type="button"
              onClick={() => {
                stopStream(streamRef.current)
                streamRef.current = null
                setCameraTick((t) => t + 1)
              }}
              className="rounded-md bg-white/20 px-3 py-1 text-xs"
            >
              Retry
            </button>
          </div>
        )}
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
        disabled={!!submitting || !worker || !siteId || briefingGate || !cameraReady || !gps}
      >
        {submitting
          ? `Submitting ${submitting.toUpperCase()}…`
          : !cameraReady
          ? 'Waiting for camera…'
          : !gps
          ? 'Waiting for GPS…'
          : `Punch ${nextType.toUpperCase()}`}
      </button>

      {/* Today's history peek — last 5 punches inline */}
      {today && today.length > 0 && (
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="mb-2 text-xs font-semibold text-slate-500">Today's punches</div>
          <ul className="flex flex-col gap-1.5">
            {today.slice(0, 5).map((row) => {
              const dt = new Date(row.punched_at)
              return (
                <li key={row.id} className="flex items-center justify-between text-xs">
                  <span className="font-mono">
                    {row.type.toUpperCase()} · {dt.toLocaleTimeString()}
                  </span>
                  <span
                    className={
                      row.status === 'verified'
                        ? 'rounded-full bg-green-100 px-2 py-0.5 text-green-700'
                        : row.status === 'flagged'
                        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-amber-800'
                        : row.status === 'rejected'
                        ? 'rounded-full bg-red-100 px-2 py-0.5 text-red-700'
                        : 'rounded-full bg-slate-100 px-2 py-0.5 text-slate-700'
                    }
                  >
                    {row.status}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <button type="button" className="btn-secondary" onClick={() => navigate('/worker/history')}>
        Full history
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

/** Marker error so we can distinguish server-side rejections from connectivity failures. */
class ServerRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerRejected'
  }
}

async function postPunch(payload: PunchPayload): Promise<{ ok: boolean; json: any }> {
  const session = (await supabase.auth.getSession()).data.session
  if (!session) throw new Error('No session — please log in again')
  const fnUrl = `${
    import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL
  }/functions/v1/punch-submit`
  const apikey =
    (import.meta.env.VITE_SUPABASE_ANON_KEY ??
      import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      '') as string
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey,
    },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, json }
}
