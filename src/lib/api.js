const GH_KEY  = 'e379a544-f2a3-4ad2-93c0-a2b43ce9047a'
const ORS_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImI0N2E1ZDUzZjc4NjQ0MDlhM2FhYjNjMDBlZWU4MTBjIiwiaCI6Im11cm11cjY0In0='

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

function chunkRoute(pts, size = 5) {
  if (pts.length <= size) return [pts]
  const chunks = []
  for (let i = 0; i < pts.length - 1; i += size - 1) {
    chunks.push(pts.slice(i, i + size))
  }
  return chunks
}

function mergePaths(paths) {
  if (paths.length === 1) return paths[0]
  const coords = paths[0].points.coordinates.slice()
  let distance = paths[0].distance
  let ascend  = paths[0].ascend  ?? 0
  let descend = paths[0].descend ?? 0
  for (let i = 1; i < paths.length; i++) {
    coords.push(...paths[i].points.coordinates.slice(1))
    distance += paths[i].distance
    ascend   += paths[i].ascend  ?? 0
    descend  += paths[i].descend ?? 0
  }
  return { points: { coordinates: coords }, distance, ascend, descend }
}

async function fetchRouteORS(pts) {
  const r = await fetch('https://api.openrouteservice.org/v2/directions/foot-hiking/geojson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': ORS_KEY },
    body: JSON.stringify({
      coordinates: pts.map(p => [+p.lng.toFixed(6), +p.lat.toFixed(6)])
    }),
    signal: AbortSignal.timeout(12000)
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error?.message || 'ORS HTTP ' + r.status)
  const feat = j.features?.[0]
  if (!feat) throw new Error('ORS: ei reittivaihtoehtoja')
  const props = feat.properties
  return {
    points: { coordinates: feat.geometry.coordinates },
    distance: props.summary.distance,
    ascend:   props.ascent  ?? 0,
    descend:  props.descent ?? 0
  }
}

async function fetchRouteGH(pts) {
  const chunks = chunkRoute(pts)
  const paths = []
  for (const chunk of chunks) {
    const r = await fetch(`https://graphhopper.com/api/1/route?key=${GH_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'foot',
        points: chunk.map(p => [+p.lng.toFixed(6), +p.lat.toFixed(6)]),
        points_encoded: false
      }),
      signal: AbortSignal.timeout(12000)
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j?.message || 'HTTP ' + r.status)
    if (!j.paths?.length) throw new Error('Ei reittivaihtoehtoja')
    paths.push(j.paths[0])
  }
  return mergePaths(paths)
}

export async function fetchRoute(pts) {
  try {
    return await fetchRouteORS(pts)
  } catch {
    return await fetchRouteGH(pts)
  }
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
