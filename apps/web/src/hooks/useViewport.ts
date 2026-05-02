import { useState, useEffect } from 'react'
import { APP_CONFIG } from '@/config/app'

const MOBILE_BP = APP_CONFIG.MOBILE_BREAKPOINT_PX
const DESKTOP_BP = APP_CONFIG.DESKTOP_BREAKPOINT_PX

export function useViewportWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 0)

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isDesktop = width >= DESKTOP_BP
  const isTablet = width >= MOBILE_BP && width < DESKTOP_BP
  const isMobile = width < MOBILE_BP

  return { width, isDesktop, isTablet, isMobile }
}

const STORAGE_KEY = 'layout-mode'

/**
 * Site-wide layout mode. Persists to localStorage so the user's preference
 * survives reloads. Initial value follows the device width unless an
 * explicit choice is stored.
 *
 * Subscribers are notified via a custom event so every mounted RoleScaffold
 * (and sibling components) re-render together when the mode toggles.
 */
export function useLayoutMode() {
  const [mode, setMode] = useState<'desktop' | 'mobile'>(() => {
    if (typeof window === 'undefined') return 'mobile'
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'mobile' || stored === 'desktop') return stored
    return window.innerWidth >= DESKTOP_BP ? 'desktop' : 'mobile'
  })

  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<'desktop' | 'mobile'>).detail
      if (next === 'desktop' || next === 'mobile') setMode(next)
    }
    window.addEventListener('layout-mode-change', onChange as EventListener)
    return () => window.removeEventListener('layout-mode-change', onChange as EventListener)
  }, [])

  const setExplicit = (next: 'desktop' | 'mobile') => {
    window.localStorage.setItem(STORAGE_KEY, next)
    window.dispatchEvent(new CustomEvent('layout-mode-change', { detail: next }))
  }

  const toggleMode = () => setExplicit(mode === 'desktop' ? 'mobile' : 'desktop')

  return { mode, toggleMode, setMode: setExplicit }
}

