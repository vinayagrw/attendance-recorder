import { useState, useEffect } from 'react'

export function useViewportWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 0)

  useEffect(() => {
    const handleResize = () => {
      setWidth(window.innerWidth)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isDesktop = width >= 1024
  const isTablet = width >= 768 && width < 1024
  const isMobile = width < 768

  return {
    width,
    isDesktop,
    isTablet,
    isMobile,
  }
}

export function useLayoutMode() {
  const [mode, setMode] = useState<'desktop' | 'mobile'>(() => {
    const stored = localStorage.getItem('layout-mode')
    if (stored === 'mobile' || stored === 'desktop') return stored
    return typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'desktop' : 'mobile'
  })

  const toggleMode = () => {
    setMode((prev) => {
      const next = prev === 'desktop' ? 'mobile' : 'desktop'
      localStorage.setItem('layout-mode', next)
      return next
    })
  }

  return { mode, toggleMode }
}

