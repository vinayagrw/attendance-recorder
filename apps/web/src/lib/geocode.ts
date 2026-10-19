// Address → lat/lng via OpenStreetMap Nominatim (free, no API key).
// Usage policy: max ~1 request/second and an identifying referer, so this is
// only called on an explicit button click, never as the user types.

export interface GeocodeResult {
  lat: number
  lng: number
  label: string
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const q = address.trim()
  if (!q) throw new Error('Enter an address first')
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Location lookup failed (${res.status}). Try again in a moment.`)
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
  if (!data.length) throw new Error('No location found for that address. Try adding the city or PIN code.')
  return { lat: Number(data[0].lat), lng: Number(data[0].lon), label: data[0].display_name }
}
