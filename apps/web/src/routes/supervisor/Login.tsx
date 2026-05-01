import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import RoleScaffold from '../_RoleScaffold'
import { signInWithPassword } from '@/lib/auth'
import { useSession } from '@/hooks/useSession'
import { logger } from '@/lib/logger'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
})

type FormValues = z.infer<typeof schema>

export default function SupervisorLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const { session, loading } = useSession()
  const [serverError, setServerError] = useState<string | null>(null)

  // The pre-protected target the user was trying to reach (set by ProtectedRoute).
  const intendedTarget =
    (location.state as { from?: string } | null)?.from ?? '/supervisor/dashboard'

  useEffect(() => {
    if (!loading && session) navigate(intendedTarget, { replace: true })
  }, [session, loading, navigate, intendedTarget])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: FormValues) => {
    setServerError(null)
    const result = await signInWithPassword(values.email, values.password)
    if (!result.ok) {
      logger.warn(`supervisor login failed: ${result.error}`, {
        module: 'SupervisorLogin',
        email: values.email,
      })
      setServerError(result.error)
    } else {
      logger.info('supervisor login ok', { module: 'SupervisorLogin', email: values.email })
    }
    // session change will trigger the useEffect above
  }

  return (
    <RoleScaffold title="Supervisor login" backTo="/">
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            className="input-field"
            {...form.register('email')}
          />
          {form.formState.errors.email && (
            <span className="text-sm text-red-600">{form.formState.errors.email.message}</span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            className="input-field"
            {...form.register('password')}
          />
          {form.formState.errors.password && (
            <span className="text-sm text-red-600">{form.formState.errors.password.message}</span>
          )}
        </label>

        {serverError && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{serverError}</div>
        )}

        <button type="submit" className="btn-primary" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-xs text-slate-400">
          Local dev seed: <code>viagr@ciklum.com</code> / <code>LocalDev2026!</code> — change after
          first login.
        </p>
      </form>
    </RoleScaffold>
  )
}
