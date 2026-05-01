import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Props {
  lat: number
  lng: number
  radiusM: number
  height?: number
}

// Lightweight Leaflet preview: tile + circle for the geofence radius.
// Polygon drawing is post-MVP — for now admins set lat/lng/radius and see
// the resulting circle. See docs/feat-anomaly-detection.md for the polygon roadmap.
export default function SiteMapPreview({ lat, lng, radiusM, height = 200 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const circleRef = useRef<L.Circle | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const map = L.map(ref.current, { attributionControl: false, zoomControl: false })
      .setView([lat, lng], 17)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)
    const circle = L.circle([lat, lng], { radius: radiusM, color: '#0284c7', weight: 2 }).addTo(map)
    L.marker([lat, lng]).addTo(map)
    mapRef.current = map
    circleRef.current = circle
    return () => {
      map.remove()
      mapRef.current = null
      circleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!mapRef.current || !circleRef.current) return
    mapRef.current.setView([lat, lng], 17)
    circleRef.current.setLatLng([lat, lng]).setRadius(radiusM)
  }, [lat, lng, radiusM])

  return <div ref={ref} className="rounded-xl overflow-hidden" style={{ height }} />
}
