import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { startSelfieStream, stopStream, captureSelfie } from '@/lib/camera'
import { getCurrentLocation } from '@/lib/geolocation'
import { getDeviceInfo } from '@/lib/deviceFingerprint'
import { workerEmail, workerPassword } from '@/hooks/useWorker'
import { logger } from '@/lib/logger'

interface PickListWorker {
  id: string
  full_name: string
  status: string
}
interface ActiveSite {
  id: string
  name: string
  project_name: string
}

type Mode = 'pick' | 'self'

export default function WorkerRegister() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [mode, setMode] = useState<Mode>('pick')
  const [workerId, setWorkerId] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [siteId, setSiteId] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)

  const { data: workers } = useQuery({
    queryKey: ['worker-register-pick-list'],
    queryFn: async (): Promise<PickListWorker[]> => {
      const { data, error } = await supabase.rpc('list_active_workers')
      if (error) {
        logger.error(error, { module: 'WorkerRegister', action: 'list_active_workers' })
        return []
      }
      return ((data as PickListWorker[]) ?? []).filter((w) =>
        ['invited', 'pending_approval'].includes(w.status),
      )
    },
  })

  const { data: sites } = useQuery({
    queryKey: ['worker-register-sites'],
    queryFn: async (): Promise<ActiveSite[]> => {
      const { data, error } = await supabase.rpc('list_active_sites')
      if (error) {
        logger.error(error, { module: 'WorkerRegister', action: 'list_active_sites' })
        return []
      }
      return (data as ActiveSite[]) ?? []
    },
  })

  // Camera setup
  useEffect(() => {
    let cancelled = false
    if (videoRef.current && !streamRef.current) {
      startSelfieStream(videoRef.current)
        .then((s) => {
          if (cancelled) {
            stopStream(s)
            return
          }
          streamRef.current = s
          setCameraReady(true)
        })
        .catch((e: Error) => {
          logger.error(e, { module: 'WorkerRegister', action: 'startSelfieStream' })
          setError(`Camera: ${e.message}`)
        })
    }
    return () => {
      cancelled = true
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (mode === 'pick' && !workerId) return setError('Pick your name')
    if (mode === 'self') {
      if (!fullName.trim()) return setError('Enter your full name')
      if (!siteId) return setError('Pick the site you work at')
    }
    if (!/^\d{4,6}$/.test(pin)) return setError('PIN is 4-6 digits')
    if (pin !== pinConfirm) return setError("PINs don't match")
    if (!videoRef.current) return setError('Camera not ready')
    if (!cameraReady) return setError('Camera still warming up — wait a moment and try again')

    setSubmitting(true)
    let createdWorkerId: string | undefined
    try {
      const gps = await getCurrentLocation().catch(() => null)
      const device = await getDeviceInfo()
      const selfie = await captureSelfie(videoRef.current, {
        timestamp: new Date().toISOString(),
        lat: gps?.lat,
        lng: gps?.lng,
      })
      setPreviewDataUrl(selfie.dataUrl)

      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/worker-register`
      const anon =
        import.meta.env.VITE_SUPABASE_ANON_KEY ??
        import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        ''

      const payload: Record<string, unknown> = {
        pin,
        selfieDataUrl: selfie.dataUrl,
        gps: gps
          ? { lat: gps.lat, lng: gps.lng, accuracy_m: gps.accuracyMeters, speed_ms: gps.speedMs }
          : null,
        deviceFingerprint: device.fingerprint,
        userAgent: device.userAgent,
      }
      if (mode === 'pick') payload.workerId = workerId
      else payload.newWorker = { fullName: fullName.trim(), phone: phone.trim() || undefined, siteId }

      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          apikey: anon,
          Authorization: `Bearer ${anon}` 
        },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        const errMsg = (json.error as string) ?? `Registration failed (${res.status})`
        logger.error(new Error(errMsg), {
          module: 'WorkerRegister',
          action: 'worker-register',
          status: res.status,
          mode,
        })
        throw new Error(errMsg)
      }
      createdWorkerId = (json.workerId as string) ?? workerId
      logger.info('worker registered', {
        module: 'WorkerRegister',
        workerId: createdWorkerId,
        mode,
        selfRegistered: !!json.selfRegistered,
      })

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: workerEmail(createdWorkerId!),
        password: workerPassword(pin, createdWorkerId!),
      })
      if (signInErr) {
        logger.error(signInErr, {
          module: 'WorkerRegister',
          action: 'auto-signin',
          workerId: createdWorkerId,
        })
        throw new Error(`Auto sign-in failed: ${signInErr.message}`)
      }

      setInfo('Registered. Awaiting supervisor approval.')
      setTimeout(() => navigate('/worker/pending', { replace: true }), 600)
    } catch (e) {
      logger.error(e, {
        module: 'WorkerRegister',
        action: 'submit',
        mode,
        workerId: createdWorkerId ?? workerId,
      })
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <RoleScaffold title="Register" backTo="/worker/login">
      <p className="text-slate-600">
        Register for the first time. A supervisor will approve before you can punch in.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode('pick')}
          className={
            mode === 'pick'
              ? 'rounded-xl bg-brand-600 py-2 text-sm font-semibold text-white'
              : 'rounded-xl bg-slate-200 py-2 text-sm font-medium text-slate-700'
          }
        >
          I'm in the list
        </button>
        <button
          type="button"
          onClick={() => setMode('self')}
          className={
            mode === 'self'
              ? 'rounded-xl bg-brand-600 py-2 text-sm font-semibold text-white'
              : 'rounded-xl bg-slate-200 py-2 text-sm font-medium text-slate-700'
          }
        >
          I'm not in the list
        </button>
      </div>

      <div className="overflow-hidden rounded-xl bg-black">
        {previewDataUrl ? (
          <img src={previewDataUrl} className="w-full" alt="captured selfie" />
        ) : (
          <video ref={videoRef} className="w-full" playsInline muted />
        )}
      </div>
      {!cameraReady && !previewDataUrl && (
        <p className="text-xs text-slate-400">Warming up camera…</p>
      )}

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {mode === 'pick' && (
          <select
            className="input-field"
            aria-label="Your name"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
          >
            <option value="">— pick your name —</option>
            {(workers ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name}
              </option>
            ))}
          </select>
        )}

        {mode === 'self' && (
          <>
            <input
              className="input-field"
              placeholder="Your full name"
              aria-label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            <input
              className="input-field"
              placeholder="Phone (optional)"
              aria-label="Phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <select
              className="input-field"
              aria-label="Site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <option value="">— pick the site you work at —</option>
              {(sites ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.project_name}
                </option>
              ))}
            </select>
          </>
        )}

        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="PIN (4-6 digits)"
          aria-label="PIN"
          className="input-field text-center"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="Confirm PIN"
          aria-label="Confirm PIN"
          className="input-field text-center"
          value={pinConfirm}
          onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
        />

        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {info && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit registration'}
        </button>
        <Link to="/worker/login" className="btn-secondary text-center">
          Back to login
        </Link>
      </form>
    </RoleScaffold>
  )
}
