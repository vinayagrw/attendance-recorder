import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { startSelfieStream, stopStream, captureSelfie } from '@/lib/camera'
import { getCurrentLocation } from '@/lib/geolocation'
import { getDeviceInfo } from '@/lib/deviceFingerprint'
import { workerEmail, workerPassword } from '@/hooks/useWorker'

interface PickListWorker {
  id: string
  full_name: string
  status: string
}

export default function WorkerRegister() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [workerId, setWorkerId] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const { data: workers } = useQuery({
    queryKey: ['worker-register-pick-list'],
    queryFn: async (): Promise<PickListWorker[]> => {
      const { data } = await supabase.rpc('list_active_workers')
      return ((data as PickListWorker[]) ?? []).filter((w) =>
        ['invited', 'pending_approval'].includes(w.status),
      )
    },
  })

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (!workerId) return setError('Pick your name')
    if (!/^\d{4,6}$/.test(pin)) return setError('PIN is 4-6 digits')
    if (pin !== pinConfirm) return setError('PINs don\'t match')
    if (!videoRef.current) return setError('Camera not ready')

    setSubmitting(true)
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
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon },
        body: JSON.stringify({
          workerId,
          pin,
          selfieDataUrl: selfie.dataUrl,
          gps: gps
            ? { lat: gps.lat, lng: gps.lng, accuracy_m: gps.accuracyMeters, speed_ms: gps.speedMs }
            : null,
          deviceFingerprint: device.fingerprint,
          userAgent: device.userAgent,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Registration failed (${res.status})`)

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: workerEmail(workerId),
        password: workerPassword(pin, workerId),
      })
      if (signInErr) throw new Error(`Auto sign-in failed: ${signInErr.message}`)

      setInfo('Registered. Awaiting supervisor approval.')
      setTimeout(() => navigate('/worker/pending', { replace: true }), 600)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <RoleScaffold title="Register" backTo="/worker/login">
      <p className="text-slate-600">
        Pick your name, set a PIN, take a selfie. A supervisor will approve you.
      </p>

      <div className="overflow-hidden rounded-xl bg-black">
        {previewDataUrl ? (
          <img src={previewDataUrl} className="w-full" alt="captured selfie" />
        ) : (
          <video ref={videoRef} className="w-full" playsInline muted />
        )}
      </div>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <select
          className="input-field"
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

        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="PIN (4-6 digits)"
          className="input-field text-center"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="Confirm PIN"
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
