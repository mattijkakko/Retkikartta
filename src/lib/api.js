const GH_KEY = 'e379a544-f2a3-4ad2-93c0-a2b43ce9047a'

export async function geocode(query) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`,
    { signal: AbortSignal.timeout(6000), headers: { 'Accept-Language': 'fi,en' } }
  )
  const json = await r.json()
  return json.map(item => {
    const a = item.address ?? {}
    const parts = [
      a.road && a.house_number ? `${a.road} ${a.house_number}` : (a.road || null),
      a.city || a.town || a.village || a.municipality || null,
      a.country !== 'Suomi' ? a.country : null
    ].filter(Boolean)
    return {
      name: parts.length ? parts.join(', ') : item.display_name.split(',')[0],
      fullName: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon)
    }
  })
}

export async function fetchRoute(pts) {
  const r = await fetch(`https://graphhopper.com/api/1/route?key=${GH_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: 'foot',
      points: pts.map(p => [+p.lng.toFixed(6), +p.lat.toFixed(6)]),
      points_encoded: false
    }),
    signal: AbortSignal.timeout(12000)
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.message || 'HTTP ' + r.status)
  if (!j.paths?.length) throw new Error('Ei reittivaihtoehtoja')
  return j.paths[0]
}

export async function fetchElevation(waypoints, max = 100) {
  if (!waypoints.length) return []
  const pts = waypoints
  let sampled
  if (pts.length <= max) {
    sampled = pts.map((p, i) => ({ p, i }))
  } else {
    sampled = []
    for (let s = 0; s < max; s++) {
      const i = Math.round(s * (pts.length - 1) / (max - 1))
      sampled.push({ p: pts[i], i })
    }
  }
  const lats = sampled.map(({ p }) => p.lat.toFixed(5)).join(',')
  const lngs = sampled.map(({ p }) => p.lng.toFixed(5)).join(',')
  const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`, {
    signal: AbortSignal.timeout(10000)
  })
  if (!r.ok) throw new Error()
  const j = await r.json()
  const elevs = j.elevation
  if (!elevs || elevs.length !== sampled.length) throw new Error()

  const result = new Array(pts.length).fill(null)
  sampled.forEach(({ i }, si) => result[i] = elevs[si])
  for (let i = 0; i < pts.length; i++) {
    if (result[i] !== null) continue
    const prev = sampled.filter(s => s.i <= i).pop()
    const next = sampled.find(s => s.i >= i)
    if (prev && next && prev.i !== next.i) {
      const t = (i - prev.i) / (next.i - prev.i)
      result[i] = result[prev.i] + t * (result[next.i] - result[prev.i])
    } else if (prev) result[i] = result[prev.i]
    else if (next) result[i] = result[next.i]
  }
  return result
}

export async function fetchSingleElevation(ll) {
  const r = await fetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${ll.lat.toFixed(5)}&longitude=${ll.lng.toFixed(5)}`,
    { signal: AbortSignal.timeout(5000) }
  )
  const j = await r.json()
  return j.elevation?.[0] ?? null
}
