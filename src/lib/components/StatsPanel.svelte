<script>
  import { st, baseSpeed } from '../state.svelte.js'
  import { haversine, toblerSpeed, fmtMins } from '../utils.js'

  function fmtDist(d) {
    return d < 1 ? (d * 1000).toFixed(0) + ' m' : d.toFixed(2) + ' km'
  }

  const dist = $derived.by(() => {
    let d = 0
    for (let i = 1; i < st.waypoints.length; i++) d += haversine(st.waypoints[i - 1], st.waypoints[i])
    return d
  })

  const timeStr = $derived.by(() => {
    if (!st.waypoints.length) return '0 min'
    const spd = baseSpeed()
    if (st.routeElevations.length === st.waypoints.length && st.waypoints.length > 1) {
      let hrs = 0
      for (let i = 1; i < st.waypoints.length; i++) {
        const dkm = haversine(st.waypoints[i - 1], st.waypoints[i])
        const dEle = (st.routeElevations[i] ?? 0) - (st.routeElevations[i - 1] ?? 0)
        const slope = dkm > 0 ? dEle / (dkm * 1000) : 0
        hrs += dkm / Math.max(toblerSpeed(slope, spd), 0.5)
      }
      return fmtMins(hrs * 60)
    }
    return fmtMins((dist / Math.max(spd, 0.1)) * 60)
  })

  const statUp = $derived.by(() => {
    if (st.routeElevations.length !== st.waypoints.length || st.waypoints.length < 2) return '– m'
    let u = 0
    for (let i = 1; i < st.waypoints.length; i++) {
      const d = (st.routeElevations[i] ?? 0) - (st.routeElevations[i - 1] ?? 0)
      if (d > 0) u += d
    }
    return u > 0 ? '+' + Math.round(u) + ' m' : '0 m'
  })

  const statDown = $derived.by(() => {
    if (st.routeElevations.length !== st.waypoints.length || st.waypoints.length < 2) return '– m'
    let d2 = 0
    for (let i = 1; i < st.waypoints.length; i++) {
      const d = (st.routeElevations[i] ?? 0) - (st.routeElevations[i - 1] ?? 0)
      if (d < 0) d2 += Math.abs(d)
    }
    return d2 > 0 ? '-' + Math.round(d2) + ' m' : '0 m'
  })
</script>

<div class="stats-panel">
  <div class="stats-row">
    <div class="stat-card"><div class="sv">{fmtDist(dist)}</div><div class="sl">Pituus</div></div>
    <div class="stat-card"><div class="sv">{timeStr}</div><div class="sl">Arvioitu aika</div></div>
  </div>
  <div class="stats-row2">
    <div class="stat-card"><div class="sv">{statUp}</div><div class="sl">⬆ Nousu</div></div>
    <div class="stat-card"><div class="sv">{statDown}</div><div class="sl">⬇ Lasku</div></div>
    <div class="stat-card"><div class="sv">{st.currentEle}</div><div class="sl">Korkeus nyt</div></div>
  </div>
</div>
