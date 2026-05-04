<script>
  import { onMount, onDestroy } from 'svelte'
  import L from 'leaflet'
  import { st, showToast } from '../state.svelte.js'
  import { haversine, rdp, catmull, trkDist, fmtDist, RDP_EPSILON, HISTORY_LIMIT, GPS_MIN_INTERVAL_MS, COND_COEFF, COND_LABEL, MODE_ICONS } from '../utils.js'
  import { fetchRoute, fetchElevation, fetchSingleElevation, geocode } from '../api.js'
  import { exportGPX, parseGPX } from '../gpx.js'
  import { saveTrack, clearTrackStorage, loadTrack } from '../storage.js'
  import SearchPanel from './SearchPanel.svelte'

  const MML_KEY  = import.meta.env.VITE_MML_KEY ?? ''
  const MML_BASE = 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0'
  const VAR_BLUE = '#3478f6'
  const LAYER_TOASTS = { osm:'🗺️ OpenStreetMap', mml:'🇫🇮 MML Maastokartta', taustakartta:'🗺️ MML Taustakartta', topo:'🏔️ Topokartta', satellite:'🛸 Satelliitti', ortho:'📷 MML Ortoilmakuva' }

  let mapEl = $state(null)
  let fileInput = $state(null)
  let map, LAYERS

  let segLines = [], gpsMarker = null, gpsCircle = null
  let trackLine = null, freehandLine = null
  let routeClickPts = [], routeMarkers = []
  let freehandPts = [], freehandActive = false, freehandStarted = false
  let watchId = null, trackTimer = null, wakeLock = null, lastGpsTime = 0, eleTimer = null

  let routeAnchors  = $state([])   // L.latLng[] — user click points, kept after buildRoute
  let routeSegments = []   // L.latLng[][] — one coord array per anchor-to-anchor leg
  let arrowMarkers  = []   // L.Marker[] — direction arrows on routed segments
  let editMarkers   = []   // L.Marker[] — draggable handles in edit mode
  let segHistory    = []   // [{anchors, segments}] — parallel to st.history

  // ── Search state ─────────────────────────────────────────────────────────────
  let searchResults  = $state([])
  let searchRoutePts = $state([])   // [{name, lat, lng}] for address-based routing
  let searchSearching = $state(false)
  let searchMarker = null
  let searchTimer = null

  let routeIndText  = $state('🧭 Napauta lähtöpiste kartalle')
  let showUseLoc    = $state(false)
  let showLoopConf  = $state(false)
  let lpLabel   = $state('')
  let lpPos     = $state({ x: 0, y: 0 })
  let lpVisible = $state(false)
  let lpTimer   = null

  function lpStart(e, label) {
    lpTimer = setTimeout(() => { lpLabel = label; lpPos = { x: e.clientX, y: e.clientY }; lpVisible = true }, 500)
  }
  function lpEnd() {
    clearTimeout(lpTimer); lpTimer = null
    if (lpVisible) setTimeout(() => { lpVisible = false }, 1200)
  }

  let spinning      = $state(false)
  let trkSpeedVal   = $state('0.0 km/h')
  let trkAccVal     = $state('–')
  let trkTimeStr    = $state('0:00')

  // ── SVG icons ────────────────────────────────────────────────────────────────
  const _s = `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`
  const IC = {
    pencil: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><path d="M11.5 2.5 L13.5 4.5 L5 13 L2 14 L3 11 Z"/><line x1="9.5" y1="4" x2="12" y2="6.5"/></svg>`,
    pen:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><path d="M2 13 Q5 3 8 8 Q11 13 14 3"/></svg>`,
    nav:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><line x1="4.5" y1="11.5" x2="12.5" y2="3.5"/><polyline points="7.5,3 13,3 13,8.5"/><circle cx="4.5" cy="11.5" r="1.8" fill="currentColor" stroke="none"/></svg>`,
    move:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><line x1="8" y1="1.5" x2="8" y2="5.5"/><line x1="8" y1="10.5" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="5.5" y2="8"/><line x1="10.5" y1="8" x2="14.5" y2="8"/><polyline points="6.5,3 8,1.5 9.5,3"/><polyline points="6.5,13 8,14.5 9.5,13"/><polyline points="3,6.5 1.5,8 3,9.5"/><polyline points="13,6.5 14.5,8 13,9.5"/></svg>`,
    loop:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><path d="M14.5 8.5 A6.5 6.5 0 1 1 9.5 2.3"/><polyline points="9.5,0.5 9.5,4 13,4"/></svg>`,
    check:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,9 6,13 14,3"/></svg>`,
    folder: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><path d="M2 5.5 L2 13 L14 13 L14 7 L7 7 L5.5 5.5 Z"/><line x1="5.5" y1="7" x2="14" y2="7"/></svg>`,
    export: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><line x1="8" y1="2" x2="8" y2="11"/><polyline points="5,8 8,11 11,8"/><line x1="3" y1="14" x2="13" y2="14"/></svg>`,
    layers: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><polyline points="1,8 8,4.5 15,8 8,11.5 1,8"/><polyline points="1,5.5 8,2 15,5.5"/><polyline points="1,10.5 8,14 15,10.5"/></svg>`,
    sat:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><circle cx="7.5" cy="8.5" r="2.5"/><path d="M4.8 5.8 A3.8 3.8 0 0 1 10.2 5.8"/><path d="M2.5 3.5 A7.2 7.2 0 0 1 12.5 3.5"/><line x1="10.5" y1="11" x2="14" y2="14"/></svg>`,
    stop:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>`,
    pin:    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><path d="M8 2 C5.5 2 3.5 4 3.5 6.5 C3.5 10.5 8 14.5 8 14.5 C8 14.5 12.5 10.5 12.5 6.5 C12.5 4 10.5 2 8 2 Z"/><circle cx="8" cy="6.5" r="2"/></svg>`,
    undo:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><path d="M3.5 8.5 A4.5 4.5 0 1 1 8 13.5"/><polyline points="3.5,4.5 3.5,8.5 7.5,8.5"/></svg>`,
    trash:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" ${_s}><line x1="2" y1="4.5" x2="14" y2="4.5"/><path d="M5 4.5 L5 13.5 L11 13.5 L11 4.5"/><path d="M6.5 2.5 L9.5 2.5"/><line x1="7" y1="7" x2="7" y2="11.5"/><line x1="9" y1="7" x2="9" y2="11.5"/></svg>`,
  }

  const hasTrack = $derived(st.trackPts.length > 1)
  const hasRoute = $derived(st.waypoints.length > 1)
  const hasAnchors = $derived(routeAnchors.length >= 2)
  const canEdit    = $derived(st.waypoints.length >= 2)
  const actionIcon = $derived(
    st.activeDrawMode === 'freehand' ? IC.pen
    : st.activeDrawMode === 'routing' ? IC.nav
    : st.activeDrawMode === 'edit'    ? IC.move
    : IC.pencil
  )

  function rl(l) { if (l) try { map.removeLayer(l) } catch(e){} return null }

  function routeColor() {
    if (st.activeBase === 'satellite' || st.activeBase === 'ortho') return '#faff00'
    if (st.activeBase === 'topo'     || st.activeBase === 'mml')    return '#e53935'
    return '#111111'
  }

  // ── Layers ──────────────────────────────────────────────────────────────────
  function setLayer(name) {
    if (!map) return
    if (name === 'hiking') {
      st.hikeOn = !st.hikeOn
      st.hikeOn ? LAYERS.hiking.addTo(map) : map.removeLayer(LAYERS.hiking)
      if (st.hikeOn) LAYERS.hiking.bringToFront()
      showToast(st.hikeOn ? '🥾 Reittikorostus päällä' : '🥾 Reittikorostus pois')
      return
    }
    map.removeLayer(LAYERS[st.activeBase])
    LAYERS[name].addTo(map)
    if (st.hikeOn) LAYERS.hiking.bringToFront()
    st.activeBase = name
    if (st.waypoints.length > 1) redraw()
    showToast(LAYER_TOASTS[name])
    st.openMenu = null
  }

  // ── Route state ─────────────────────────────────────────────────────────────
  function saveRouteState() {
    st.history.push({ wp: st.waypoints.map(p => L.latLng(p.lat, p.lng)), wt: [...st.wpTypes] })
    segHistory.push({ anchors: routeAnchors.map(p => L.latLng(p.lat, p.lng)), segments: routeSegments.map(s => [...s]) })
    if (st.history.length > HISTORY_LIMIT) st.history.shift()
    if (segHistory.length > HISTORY_LIMIT) segHistory.shift()
  }

  function splitRouteByAnchors(coords, anchors) {
    if (anchors.length < 2 || coords.length < 2) return [coords]
    const segments = []
    let splitIdx = 0
    for (let a = 1; a < anchors.length - 1; a++) {
      const anchor = anchors[a]
      let bestIdx = splitIdx + 1, bestDist = Infinity
      for (let i = splitIdx + 1; i < coords.length - 1; i++) {
        const d = haversine(anchor, coords[i])
        if (d < bestDist) { bestDist = d; bestIdx = i }
        else if (d > bestDist + 0.1 && bestDist < 0.05) break
      }
      segments.push(coords.slice(splitIdx, bestIdx + 1))
      splitIdx = bestIdx
    }
    segments.push(coords.slice(splitIdx))
    return segments
  }

  function detectSegmentOverlap(seg1, seg2) {
    if (!seg1.length || !seg2.length) return false
    const mid1 = seg1[Math.floor(seg1.length / 2)]
    const mid2 = seg2[Math.floor(seg2.length / 2)]
    return haversine(mid1, mid2) < 0.03
  }

  function addArrowsToSegment(latlngs, color) {
    if (latlngs.length < 2) return
    const PX_INTERVAL = 100, MAX_ARROWS = 30
    const screenPts = latlngs.map(ll => map.latLngToContainerPoint(ll))
    const cumDist = [0]
    for (let i = 1; i < screenPts.length; i++) {
      const dx = screenPts[i].x - screenPts[i-1].x, dy = screenPts[i].y - screenPts[i-1].y
      cumDist.push(cumDist[i-1] + Math.sqrt(dx*dx + dy*dy))
    }
    const totalPx = cumDist[cumDist.length - 1]
    if (totalPx < PX_INTERVAL) return
    const count = Math.min(Math.floor(totalPx / PX_INTERVAL), MAX_ARROWS)
    for (let k = 1; k <= count; k++) {
      const targetDist = (k / (count + 1)) * totalPx
      let lo = 0, hi = cumDist.length - 2
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cumDist[mid+1] < targetDist) lo = mid+1; else hi = mid }
      const t = (targetDist - cumDist[lo]) / (cumDist[lo+1] - cumDist[lo] || 1)
      const px = screenPts[lo].x + t * (screenPts[lo+1].x - screenPts[lo].x)
      const py = screenPts[lo].y + t * (screenPts[lo+1].y - screenPts[lo].y)
      const dx = screenPts[lo+1].x - screenPts[lo].x, dy = screenPts[lo+1].y - screenPts[lo].y
      const angleDeg = Math.atan2(dx, -dy) * 180 / Math.PI
      const ll = map.containerPointToLatLng([px, py])
      arrowMarkers.push(L.marker(ll, {
        icon: L.divIcon({
          className: '',
          html: `<div class="route-arrow" style="color:${color};transform:rotate(${angleDeg.toFixed(1)}deg)">▲</div>`,
          iconSize: [16, 16], iconAnchor: [8, 8]
        }),
        interactive: false, keyboard: false, zIndexOffset: -100
      }).addTo(map))
    }
  }

  function applyOffset(latlngs, runIdx) {
    if (runIdx % 2 === 0 || latlngs.length < 2) return latlngs
    const zoom = map.getZoom()
    const midLat = latlngs[Math.floor(latlngs.length / 2)].lat * Math.PI / 180
    const mPerPx = 156543.03392 * Math.cos(midLat) / Math.pow(2, zoom)
    const offsetM = 5 * mPerPx
    const dLat = offsetM / 111320
    const dLng = offsetM / (111320 * Math.cos(midLat))
    return latlngs.map((ll, i) => {
      const a = latlngs[Math.max(0, i - 1)], b = latlngs[Math.min(latlngs.length - 1, i + 1)]
      const dlng = b.lng - a.lng, dlat = b.lat - a.lat
      const len = Math.sqrt(dlng * dlng + dlat * dlat) || 1
      return L.latLng(ll.lat + (dlng / len) * dLat, ll.lng + (-dlat / len) * dLng)
    })
  }

  function redraw() {
    segLines.forEach(l => rl(l)); segLines = []
    arrowMarkers.forEach(m => rl(m)); arrowMarkers = []
    if (st.waypoints.length < 2) return
    const color = routeColor()

    if (routeSegments.length > 0) {
      for (let i = 0; i < routeSegments.length; i++) {
        const raw = routeSegments[i]
        if (raw.length < 2) continue
        const overlaps = i > 0 && detectSegmentOverlap(routeSegments[i-1], raw)
        const pts = applyOffset(raw, overlaps ? 1 : 0)
        segLines.push(L.polyline(pts, { color, weight: 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round' }).addTo(map))
        addArrowsToSegment(pts, color)
      }
    } else {
      let i = 0, runIdx = 0
      while (i < st.waypoints.length - 1) {
        const type = st.wpTypes[i] || 'drawn'
        let j = i + 1
        while (j < st.waypoints.length && (st.wpTypes[j] || 'drawn') === type) j++
        const pts = applyOffset(st.waypoints.slice(i, j < st.waypoints.length ? j + 1 : j), runIdx)
        if (pts.length > 1) {
          segLines.push(L.polyline(pts, { color, weight: 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round', dashArray: type === 'routed' ? null : '10,6' }).addTo(map))
          if (type === 'routed') addArrowsToSegment(pts, color)
        }
        i = j; runIdx++
      }
    }
    scheduleEle()
  }

  function addPt(ll, type) { saveRouteState(); st.waypoints = [...st.waypoints, ll]; st.wpTypes = [...st.wpTypes, type]; routeAnchors = []; routeSegments = []; redraw() }

  function undoLast() {
    if (st.activeDrawMode === 'routing') {
      if (!routeClickPts.length) { showToast('Ei kumottavaa'); return }
      routeClickPts.pop()
      const m = routeMarkers.pop(); if (m) rl(m)
      const n = routeClickPts.length
      if (n === 0) { routeIndText = '🧭 Napauta lähtöpiste kartalle'; showUseLoc = true; showLoopConf = false }
      else if (n === 1) { routeIndText = '🧭 Napauta seuraava piste tai määränpää'; showLoopConf = false }
      else routeIndText = `🧭 ${n} pistettä — Valmis tai Ympyrä`
      showToast('↩️ Kumottu'); return
    }
    if (!st.history.length) { showToast('Ei kumottavaa'); return }
    const s = st.history.pop(), ss = segHistory.pop() ?? { anchors: [], segments: [] }
    st.waypoints = s.wp; st.wpTypes = s.wt
    routeAnchors = ss.anchors; routeSegments = ss.segments
    redraw()
    if (st.activeDrawMode === 'edit') buildEditMarkers()
    showToast('↩️ Kumottu')
  }

  function clearAll() {
    stopDraw(); stopFreehand(); cancelRouting(); stopEdit()
    segLines.forEach(l => rl(l)); segLines = []
    arrowMarkers.forEach(m => rl(m)); arrowMarkers = []
    gpsMarker = rl(gpsMarker); gpsCircle = rl(gpsCircle); trackLine = rl(trackLine); freehandLine = rl(freehandLine)
    st.waypoints = []; st.wpTypes = []; st.history = []; st.routeElevations = []; st.trackPts = []
    freehandPts = []; routeAnchors = []; routeSegments = []; segHistory = []
    clearTrackStorage(); st.currentEle = '– m'; showToast('Kartta tyhjennetty')
  }

  // ── Draw ────────────────────────────────────────────────────────────────────
  function toggleDraw()    { st.activeDrawMode === 'draw'     ? stopDraw()       : startDraw() }
  function toggleFreehand(){ st.activeDrawMode === 'freehand' ? stopFreehand()   : startFreehand() }
  function toggleRouting() { st.activeDrawMode === 'routing'  ? cancelRouting()  : startRouting() }

  function startDraw() {
    stopFreehand(); cancelRouting()
    st.activeDrawMode = 'draw'; st.openMenu = null
    map.getContainer().style.cursor = 'crosshair'; showToast('✏️ Napauta karttaan')
  }
  function stopDraw() {
    if (st.activeDrawMode === 'draw') st.activeDrawMode = null
    map.getContainer().style.cursor = ''
  }

  // ── Freehand ────────────────────────────────────────────────────────────────
  function startFreehand() {
    stopDraw(); cancelRouting()
    st.activeDrawMode = 'freehand'; st.openMenu = null; showToast('🖊️ Piirrä sormella kartalle')
  }
  function stopFreehand() {
    if (st.activeDrawMode === 'freehand') st.activeDrawMode = null
    map.dragging.enable(); map.getContainer().style.cursor = ''; cleanFH()
  }
  function cleanFH() { freehandLine = rl(freehandLine); freehandPts = []; freehandActive = false; freehandStarted = false }

  function closestCandidates(ll, n) {
    return st.waypoints
      .map((p, i) => ({ i, d: haversine(ll, p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map(x => x.i)
  }
  function spliceFH(pts) {
    if (pts.length < 2) return
    saveRouteState()
    if (!st.waypoints.length) { st.waypoints = pts; st.wpTypes = pts.map(() => 'drawn'); routeAnchors = []; routeSegments = []; redraw(); showToast('✅ Vapaa reitti lisätty'); return }
    const pStart = pts[0], pEnd = pts[pts.length - 1], pMid = pts[Math.floor(pts.length / 2)]
    const sCands = closestCandidates(pStart, 20), eCands = closestCandidates(pEnd, 20)
    let si = 0, ei = Math.min(1, st.waypoints.length - 1), bestScore = Infinity
    for (const a of sCands) {
      for (const b of eCands) {
        if (a === b) continue
        const lo = Math.min(a, b), hi = Math.max(a, b)
        const score = haversine(pStart, st.waypoints[a])
                    + haversine(pEnd,   st.waypoints[b])
                    + haversine(pMid,   st.waypoints[Math.floor((lo + hi) / 2)])
        if (score < bestScore) { bestScore = score; si = a; ei = b }
      }
    }
    const lo = Math.min(si, ei), hi = Math.max(si, ei)
    const ordered = si <= ei ? pts : [...pts].reverse()
    st.waypoints = [...st.waypoints.slice(0, lo + 1), ...ordered, ...st.waypoints.slice(hi)]
    st.wpTypes   = [...st.wpTypes.slice(0, lo + 1), ...ordered.map(() => 'drawn'), ...st.wpTypes.slice(hi)]
    st.routeElevations = []; routeAnchors = []; routeSegments = []; redraw(); showToast('✅ Osuus korvattu')
  }

  function fhStart(rx, ry) {
    map.dragging.disable(); freehandActive = true; freehandStarted = false; freehandPts = []
    freehandLine = rl(freehandLine); freehandPts.push(map.containerPointToLatLng([rx, ry]))
  }
  function fhMove(cx, cy) {
    const r = mapEl.getBoundingClientRect(), rx = cx - r.left, ry = cy - r.top
    const ll = map.containerPointToLatLng([rx, ry]), last = freehandPts[freehandPts.length - 1]
    if (last && haversine(last, ll) < 0.015) return
    freehandPts.push(ll); freehandStarted = freehandPts.length >= 4
    if (!freehandStarted) return
    if (!freehandLine) freehandLine = L.polyline(freehandPts, { color: routeColor(), weight: 4, opacity: 0.85, dashArray: '10,6', lineJoin: 'round', lineCap: 'round' }).addTo(map)
    else freehandLine.setLatLngs(freehandPts)
    const edge = 60, spd = 6; let dx = 0, dy = 0
    if (rx < edge) dx = -Math.round((edge - rx) / edge * spd); else if (rx > r.width - edge) dx = Math.round((edge - (r.width - rx)) / edge * spd)
    if (ry < edge) dy = -Math.round((edge - ry) / edge * spd); else if (ry > r.height - edge) dy = Math.round((edge - (r.height - ry)) / edge * spd)
    if (dx || dy) map.panBy([dx, dy], { animate: false })
  }
  function fhEnd() {
    map.dragging.enable(); freehandActive = false
    if (!freehandStarted || freehandPts.length < 5) { cleanFH(); return }
    let dist = 0; for (let i = 1; i < freehandPts.length; i++) dist += haversine(freehandPts[i - 1], freehandPts[i])
    if (dist < 0.03) { cleanFH(); return }
    freehandLine = rl(freehandLine); spliceFH(rdp(freehandPts, RDP_EPSILON)); freehandPts = []; freehandStarted = false
  }

  // ── Routing ─────────────────────────────────────────────────────────────────
  function startRouting() {
    stopDraw(); stopFreehand()
    st.activeDrawMode = 'routing'; routeClickPts = []; routeMarkers.forEach(m => rl(m)); routeMarkers = []
    st.openMenu = null; routeIndText = '🧭 Napauta lähtöpiste kartalle'; showUseLoc = true; showLoopConf = false
    map.getContainer().style.cursor = 'crosshair'
    if (navigator.geolocation && confirm('Käytetäänkö nykyistä sijaintiasi lähtöpisteenä?')) useLocationAsStart()
  }
  function cancelRouting() {
    if (st.activeDrawMode === 'routing') st.activeDrawMode = null
    routeClickPts = []; routeMarkers.forEach(m => rl(m)); routeMarkers = []
    showUseLoc = false; showLoopConf = false
    map.getContainer().style.cursor = ''
    // routeAnchors/routeSegments intentionally kept for edit mode
  }
  // ── Edit mode ────────────────────────────────────────────────────────────────
  function initAnchorsFromWaypoints() {
    const wp = st.waypoints
    if (wp.length < 2) return
    let totalDist = 0
    for (let i = 1; i < wp.length; i++) totalDist += haversine(wp[i-1], wp[i])
    const target = Math.min(12, Math.max(2, Math.round(totalDist / 0.3)))
    const step = (wp.length - 1) / (target - 1)
    const anchors = []
    for (let k = 0; k < target - 1; k++) anchors.push(L.latLng(wp[Math.round(k * step)].lat, wp[Math.round(k * step)].lng))
    anchors.push(L.latLng(wp[wp.length - 1].lat, wp[wp.length - 1].lng))
    routeAnchors = anchors
    routeSegments = splitRouteByAnchors(wp, anchors)
  }

  function toggleEdit() { st.activeDrawMode === 'edit' ? stopEdit() : startEdit() }
  function startEdit() {
    if (!canEdit) { showToast('⚠️ Ei reittiä muokattavaksi'); return }
    stopDraw(); stopFreehand(); cancelRouting()
    if (!hasAnchors) initAnchorsFromWaypoints()
    st.activeDrawMode = 'edit'; st.openMenu = null
    map.getContainer().style.cursor = 'grab'
    showToast('✋ Vedä ankkuripisteitä reitin muuttamiseksi')
    buildEditMarkers()
  }
  function stopEdit() {
    if (st.activeDrawMode === 'edit') st.activeDrawMode = null
    editMarkers.forEach(m => rl(m)); editMarkers = []
    map.getContainer().style.cursor = ''
  }
  function buildEditMarkers() {
    editMarkers.forEach(m => rl(m)); editMarkers = []
    routeAnchors.forEach((anchor, i) => {
      const isStart = i === 0, isEnd = i === routeAnchors.length - 1
      const cls  = isStart ? 'edit-anchor edit-anchor-start' : isEnd ? 'edit-anchor edit-anchor-end' : 'edit-anchor'
      const size = (isStart || isEnd) ? 20 : 16
      const marker = L.marker(anchor, {
        icon: L.divIcon({ className: '', html: `<div class="${cls}"></div>`, iconSize: [size, size], iconAnchor: [size/2, size/2] }),
        draggable: true, autoPan: true, keyboard: false, zIndexOffset: 500
      }).addTo(map)
      marker.on('dragstart', () => { map.getContainer().style.cursor = 'grabbing' })
      marker.on('dragend', async () => {
        map.getContainer().style.cursor = 'grab'
        saveRouteState()
        routeAnchors[i] = marker.getLatLng()
        spinning = true
        try {
          const path = await fetchRoute([...routeAnchors])
          const routed = path.points.coordinates.map(c => { const ll = L.latLng(c[1], c[0]); ll.ele = c[2] ?? null; return ll })
          st.waypoints = routed; st.wpTypes = routed.map(() => 'routed'); st.routeElevations = []
          routeSegments = splitRouteByAnchors(routed, routeAnchors)
          redraw(); showToast(`🧭 ${(path.distance / 1000).toFixed(2)} km`)
        } catch(e) {
          routeAnchors[i] = anchor; marker.setLatLng(anchor)
          showToast('⚠️ Reititys epäonnistui')
        } finally { spinning = false; buildEditMarkers() }
      })
      editMarkers.push(marker)
    })
  }

  function addRoutePoint(ll) {
    routeClickPts.push(ll)
    const n = routeClickPts.length, isFirst = n === 1
    const icon = L.divIcon({ className: '', html: `<div class="wp ${isFirst ? 'wp-s' : 'wp-m'}" style="${isFirst ? '' : 'background:' + routeColor()}"></div>`, iconSize: [isFirst ? 18 : 14, isFirst ? 18 : 14], iconAnchor: [isFirst ? 9 : 7, isFirst ? 9 : 7] })
    routeMarkers.push(L.marker(ll, { icon }).addTo(map))
    if (n === 1) { routeIndText = '🧭 Napauta seuraava piste tai määränpää'; showUseLoc = false }
    else { routeIndText = `🧭 ${n} pistettä — Valmis tai Ympyrä`; showLoopConf = true }
  }
  function useLocationAsStart() {
    showToast('Haetaan sijaintia…')
    navigator.geolocation.getCurrentPosition(pos => { const ll = L.latLng(pos.coords.latitude, pos.coords.longitude); map.setView(ll, 14); addRoutePoint(ll); showToast('📍 Sijaintisi lisätty lähtöpisteeksi') }, () => showToast('⚠️ Sijaintia ei löydy'), { enableHighAccuracy: true, timeout: 10000 })
  }
  async function confirmRoute() { await buildRoute([...routeClickPts]) }
  async function closeLoop()   { if (routeClickPts.length >= 2) await buildRoute([...routeClickPts, routeClickPts[0]]) }
  async function buildRoute(pts) {
    if (pts.length < 2) { showToast('⚠️ Lisää vähintään 2 pistettä'); return }
    spinning = true
    try {
      const path = await fetchRoute(pts)
      const routed = path.points.coordinates.map(c => { const ll = L.latLng(c[1], c[0]); ll.ele = c[2] ?? null; return ll })
      saveRouteState()
      st.waypoints = routed; st.wpTypes = routed.map(() => 'routed'); st.routeElevations = []
      routeAnchors  = pts.map(p => L.latLng(p.lat, p.lng))
      routeSegments = splitRouteByAnchors(routed, routeAnchors)
      redraw()
      if (segLines.length) map.fitBounds(segLines[0].getBounds(), { padding: [30, 30] })
      showToast(`🧭 ${(path.distance / 1000).toFixed(2)} km löydetty`)
    } catch(e) { showToast('⚠️ ' + e.message.slice(0, 100)) }
    finally { spinning = false; cancelRouting() }
  }

  // ── Elevation ───────────────────────────────────────────────────────────────
  function scheduleEle() {
    clearTimeout(eleTimer)
    // Skip API fetch if elevations are already populated (e.g. from GPX import)
    if (st.waypoints.length > 0 && st.routeElevations.length !== st.waypoints.length)
      eleTimer = setTimeout(fetchEle, 1200)
  }
  async function fetchEle() {
    if (!st.waypoints.length) return
    try {
      const elevs = await fetchElevation(st.waypoints)
      st.routeElevations = elevs
      const last = elevs[elevs.length - 1]
      if (last !== null) st.currentEle = Math.round(last) + ' m'
    } catch(e) {}
  }

  // ── GPS ─────────────────────────────────────────────────────────────────────
  async function reqWL() { if (!('wakeLock' in navigator)) return; try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null) } catch(e) {} }
  function relWL() { if (wakeLock) { wakeLock.release(); wakeLock = null } }

  function toggleTracking() { st.tracking ? stopTracking() : startTracking() }
  function startTracking() {
    if (!navigator.geolocation) { showToast('⚠️ GPS ei tuettu'); return }
    st.tracking = true; st.trackPts = []; st.trackStart = Date.now(); st.centerLocked = true; lastGpsTime = 0
    trackLine = rl(trackLine); clearTrackStorage(); reqWL()
    watchId = navigator.geolocation.watchPosition(onGps, () => showToast('⚠️ GPS-virhe'), { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 })
    trackTimer = setInterval(updateTrkTime, 1000); showToast('🛰️ GPS-seuranta käynnistetty')
  }
  function stopTracking() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null }
    clearInterval(trackTimer); st.tracking = false; relWL(); saveTrack(st.trackPts, st.trackStart)
    showToast(`⏹️ ${fmtDist(trkDist(st.trackPts))} tallennettu`)
  }
  function onGps(pos) {
    const now = Date.now(); if (now - lastGpsTime < GPS_MIN_INTERVAL_MS) return; lastGpsTime = now
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude); ll.ele = pos.coords.altitude ?? null
    placeGpsDot(ll, pos.coords.accuracy); st.trackPts = [...st.trackPts, ll]
    if (ll.ele !== null) st.currentEle = Math.round(ll.ele) + ' m'
    if (st.trackPts.length % 10 === 0) saveTrack(st.trackPts, st.trackStart)
    if (st.trackPts.length > 1) {
      const sm = catmull(st.trackPts)
      if (!trackLine) trackLine = L.polyline(sm, { color: VAR_BLUE, weight: 4, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }).addTo(map)
      else trackLine.setLatLngs(sm)
    }
    if (st.centerLocked) map.panTo(ll, { animate: true, duration: 0.5 })
    const spd = pos.coords.speed; if (spd !== null && spd >= 0) trkSpeedVal = (spd * 3.6).toFixed(1) + ' km/h'
    trkAccVal = pos.coords.accuracy < 10 ? '✅ ' + pos.coords.accuracy.toFixed(0) + 'm' : pos.coords.accuracy.toFixed(0) + ' m'
  }
  function placeGpsDot(ll, acc) {
    gpsMarker = rl(gpsMarker); gpsCircle = rl(gpsCircle)
    if (acc && acc < 300) gpsCircle = L.circle(ll, { radius: acc, color: VAR_BLUE, fillColor: VAR_BLUE, fillOpacity: 0.07, weight: 1, opacity: 0.35 }).addTo(map)
    gpsMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="gps-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000 }).addTo(map)
  }
  function updateTrkTime() {
    if (!st.trackStart) return
    const e = Math.floor((Date.now() - st.trackStart) / 1000)
    const h = Math.floor(e / 3600), m = Math.floor((e % 3600) / 60), s = e % 60
    trkTimeStr = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
  }
  function toggleCenter() { st.centerLocked = !st.centerLocked; if (st.centerLocked && gpsMarker) map.panTo(gpsMarker.getLatLng()) }

  function locateOnce() {
    showToast('Haetaan sijaintia…')
    navigator.geolocation.getCurrentPosition(async pos => {
      const ll = L.latLng(pos.coords.latitude, pos.coords.longitude)
      map.setView(ll, 14); placeGpsDot(ll, pos.coords.accuracy)
      if (pos.coords.altitude !== null) st.currentEle = Math.round(pos.coords.altitude) + ' m'
      else { const e = await fetchSingleElevation(ll); if (e !== null) st.currentEle = Math.round(e) + ' m' }
      showToast('📍 Sijainti löydetty!')
      if (st.activeDrawMode === 'draw') addPt(ll, 'drawn')
    }, () => showToast('⚠️ Sijaintia ei löydy'), { enableHighAccuracy: true, timeout: 10000 })
  }

  // ── GPX ─────────────────────────────────────────────────────────────────────
  function doExportGPX(type) {
    const pts = type === 'track' ? st.trackPts : st.waypoints
    if (!pts.length) { showToast('Ei pisteitä'); return }
    exportGPX(pts, type); showToast('⬇️ GPX ladattu!')
  }
  function doImportGPX(event) {
    const file = event.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const { pts, isTrk, name } = parseGPX(e.target.result)
        if (!pts.length) { showToast('⚠️ Ei pisteitä'); return }
        if (isTrk) {
          // GPS track log (already walked) — show as blue line only
          trackLine = rl(trackLine); st.trackPts = pts
          trackLine = L.polyline(pts, { color: VAR_BLUE, weight: 4, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }).addTo(map)
          map.fitBounds(trackLine.getBounds(), { padding: [30, 30] })
        } else {
          // Planned route or waypoints — import as waypoints so stats work
          saveRouteState(); st.waypoints = pts; st.wpTypes = pts.map(() => 'drawn')
          // Use elevation embedded in GPX if all points have it; otherwise fetch from API
          const embeddedEles = pts.map(p => p.ele ?? null)
          if (embeddedEles.every(e => e !== null)) {
            st.routeElevations = embeddedEles
            const last = embeddedEles[embeddedEles.length - 1]
            if (last !== null) st.currentEle = Math.round(last) + ' m'
          } else {
            st.routeElevations = []
          }
          redraw(); if (segLines.length) map.fitBounds(segLines[0].getBounds(), { padding: [30, 30] })
        }
        showToast(`📂 ${name || file.name} (${pts.length} pistettä)`)
      } catch(err) { showToast('⚠️ GPX-virhe') }
      event.target.value = ''
    }
    reader.readAsText(file)
  }

  // ── Search ──────────────────────────────────────────────────────────────────
  function onSearchQuery(q) {
    clearTimeout(searchTimer)
    searchResults = []
    if (q.length < 3) { searchSearching = false; return }
    searchSearching = true
    searchTimer = setTimeout(async () => {
      try { searchResults = await geocode(q) } catch(e) { showToast('⚠️ Hakuvirhe') }
      searchSearching = false
    }, 400)
  }

  function placeSearchMarker(ll) {
    if (searchMarker) try { map.removeLayer(searchMarker) } catch(e) {}
    searchMarker = L.marker(ll, {
      icon: L.divIcon({ className: '', html: '<div class="wp wp-s"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })
    }).addTo(map)
  }

  function onSearchSelect(r) {
    const ll = L.latLng(r.lat, r.lng)
    map.setView(ll, 15)
    placeSearchMarker(ll)
    st.searchOpen = false
    searchResults = []
  }

  function onSearchStartRoute(r) {
    const ll = L.latLng(r.lat, r.lng)
    map.setView(ll, 14)
    st.searchOpen = false
    searchResults = []
    // Start routing mode and add this location as first waypoint
    stopDraw(); stopFreehand()
    if (st.activeDrawMode === 'routing') cancelRouting()
    st.activeDrawMode = 'routing'
    routeClickPts = []; routeMarkers.forEach(m => rl(m)); routeMarkers = []
    st.openMenu = null; showUseLoc = false; showLoopConf = false
    map.getContainer().style.cursor = 'crosshair'
    addRoutePoint(ll)
    showToast(`🧭 Reitti alkaa: ${r.name}`)
  }

  function onSearchAddToRoute(r) {
    searchRoutePts = [...searchRoutePts, r]
    const ll = L.latLng(r.lat, r.lng)
    placeSearchMarker(ll)
    map.setView(ll, 14)
    searchResults = []
  }

  function onSearchRemoveRoute(i) {
    searchRoutePts = searchRoutePts.filter((_, idx) => idx !== i)
  }

  async function onSearchBuildRoute() {
    if (searchRoutePts.length < 2) return
    const pts = searchRoutePts.map(p => L.latLng(p.lat, p.lng))
    searchRoutePts = []
    st.searchOpen = false
    if (searchMarker) { try { map.removeLayer(searchMarker) } catch(e) {} searchMarker = null }
    await buildRoute(pts)
  }

  // ── Map events ───────────────────────────────────────────────────────────────
  function onMapClick(e) {
    st.openMenu = null
    if (st.activeDrawMode === 'draw') addPt(e.latlng, 'drawn')
    else if (st.activeDrawMode === 'routing') addRoutePoint(e.latlng)
  }
  function onTouchStart(e) { if (st.activeDrawMode !== 'freehand') return; e.preventDefault(); const t = e.touches[0], r = mapEl.getBoundingClientRect(); fhStart(t.clientX - r.left, t.clientY - r.top) }
  function onTouchMove(e)  { if (st.activeDrawMode !== 'freehand' || !freehandActive) return; e.preventDefault(); fhMove(e.touches[0].clientX, e.touches[0].clientY) }
  function onTouchEnd(e)   { if (st.activeDrawMode !== 'freehand' || !freehandActive) return; e.preventDefault(); fhEnd() }
  function onMouseDown(e)  { if (st.activeDrawMode !== 'freehand' || e.button !== 0) return; const r = mapEl.getBoundingClientRect(); fhStart(e.clientX - r.left, e.clientY - r.top) }
  function onMouseMove(e)  { if (st.activeDrawMode === 'freehand' && freehandActive) fhMove(e.clientX, e.clientY) }
  function onMouseUp()     { if (st.activeDrawMode === 'freehand' && freehandActive) fhEnd() }

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  onMount(() => {
    LAYERS = {
      osm:          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, subdomains: 'abc' }),
      taustakartta: L.tileLayer(`${MML_BASE}/taustakartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key=${MML_KEY}`, { maxZoom: 21, maxNativeZoom: 16 }),
      mml:          L.tileLayer(`${MML_BASE}/maastokartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key=${MML_KEY}`, { maxZoom: 21, maxNativeZoom: 18 }),
      topo:         L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 17, subdomains: 'abc' }),
      satellite:    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19 }),
      ortho:        L.tileLayer(`${MML_BASE}/ortokuva/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key=${MML_KEY}`, { maxZoom: 21, maxNativeZoom: 19 }),
      hiking:       L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, opacity: 0.8 })
    }
    map = L.map(mapEl, { center: [62.5, 25.7], zoom: 6, maxZoom: 21, zoomControl: true, attributionControl: false })
    LAYERS.taustakartta.addTo(map); map.on('click', onMapClick); map.on('zoomend', redraw)
    mapEl.addEventListener('touchstart', onTouchStart, { passive: false })
    mapEl.addEventListener('touchmove',  onTouchMove,  { passive: false })
    mapEl.addEventListener('touchend',   onTouchEnd,   { passive: false })
    mapEl.addEventListener('mousedown',  onMouseDown)
    mapEl.addEventListener('mousemove',  onMouseMove)
    mapEl.addEventListener('mouseup',    onMouseUp)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.tracking) reqWL() })

    const saved = loadTrack()
    if (saved) {
      st.trackPts = saved.pts; st.trackStart = saved.start
      trackLine = L.polyline(saved.pts, { color: VAR_BLUE, weight: 4, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }).addTo(map)
      map.fitBounds(trackLine.getBounds(), { padding: [30, 30] })
      showToast('📂 Edellinen reitti palautettu')
    }
    showToast('Tervetuloa Retkikarttaan! 🌲')

    // Locate user on startup if geolocation is available
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async pos => {
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude)
        map.setView(ll, 13); placeGpsDot(ll, pos.coords.accuracy)
        if (pos.coords.altitude !== null) st.currentEle = Math.round(pos.coords.altitude) + ' m'
        else { const e = await fetchSingleElevation(ll); if (e !== null) st.currentEle = Math.round(e) + ' m' }
      }, () => {}, { enableHighAccuracy: true, timeout: 10000 })
    }
  })

  onDestroy(() => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId)
    clearInterval(trackTimer); clearTimeout(eleTimer); relWL()
    if (map) map.remove()
  })

  const BASE_LAYERS = [
    { id: 'taustakartta', label: 'MML Taustakartta' },
    { id: 'mml',          label: 'MML Maastokartta' },
    { id: 'osm',          label: 'OpenStreetMap' },
    { id: 'topo',         label: 'Topokartta' },
    { id: 'satellite',    label: 'Satelliitti' },
    { id: 'ortho',        label: 'MML Ilmakuva' },
    { id: 'hiking',       label: '+ Reitit' },
  ]
  const MODES = [
    { id: 'walk', label: '🚶 Kävely' },
    { id: 'dog',  label: '🐕 Koira' },
    { id: 'run',  label: '🏃 Juoksu' },
  ]
  const CONDS = [
    { id: 'summer', label: '☀️ Kesä / kuiva' },
    { id: 'autumn', label: '🍂 Syksy / märkä' },
    { id: 'crust',  label: '❄️ Talvi / hanki' },
    { id: 'snow30', label: '🌨️ Lumi <30 cm' },
    { id: 'snow60', label: '🌨️ Lumi >30 cm' },
  ]

  function setMode(m) {
    st.currentMode = m
    if (m !== 'run') st.openMenu = null
    showToast({ walk: '🚶 Kävelytila', dog: '🐕 Koiratila', run: '🏃 Juoksutila' }[m])
  }
  function setCond(c) {
    st.currentCond = c; st.openMenu = null
    showToast(c !== 'summer' ? COND_LABEL[c] + ' — hidastuskerroin ' + (COND_COEFF[c] * 100).toFixed(0) + '%' : '☀️ Kesäolosuhteet')
  }
</script>

<div id="mapwrap">
  <div id="map" bind:this={mapEl}></div>

  <!-- SEARCH PANEL -->
  {#if st.searchOpen}
    <SearchPanel
      results={searchResults}
      routePts={searchRoutePts}
      searching={searchSearching}
      onQueryInput={onSearchQuery}
      onSelect={onSearchSelect}
      onStartRoute={onSearchStartRoute}
      onAddToRoute={onSearchAddToRoute}
      onRemoveRoute={onSearchRemoveRoute}
      onBuildRoute={onSearchBuildRoute}
      onClose={() => { st.searchOpen = false; searchResults = []; searchRoutePts = [] }}
    />
  {/if}

  <!-- LAYER PILL -->
  <div class="pill" id="stackLayer">
    <button class="layer-toggle" onclick={() => st.openMenu = st.openMenu === 'layer' ? null : 'layer'} title="Karttapohja">{@html IC.layers}</button>
    <div class="layer-menu" class:open={st.openMenu === 'layer'}>
      {#each BASE_LAYERS as l}
        <button class="lbtn" class:active={l.id === 'hiking' ? st.hikeOn : st.activeBase === l.id} onclick={() => setLayer(l.id)}>
          <span class="ldot"></span>{l.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- MODE PILL -->
  <div class="pill" id="stackMode">
    <button class="toggle-btn" onclick={() => st.openMenu = st.openMenu === 'mode' ? null : 'mode'}>{MODE_ICONS[st.currentMode]}</button>
    <div class="collapse-menu" class:open={st.openMenu === 'mode'}>
      {#each MODES as m}
        <button class="mbtn" class:active={st.currentMode === m.id} onclick={() => setMode(m.id)}>{m.label}</button>
      {/each}
      {#if st.currentMode === 'run'}
        <div id="speedPanel">
          <div class="speed-label">Juoksuvauhti tasamaalla</div>
          <div class="speed-row">
            <input type="range" min="4" max="20" step="0.5" value={st.runSpeed} oninput={e => st.runSpeed = parseFloat(e.target.value)}>
            <span class="speed-val">{st.runSpeed.toFixed(1)} km/h</span>
          </div>
        </div>
      {/if}
      <div class="cond-divider">Maasto-olosuhteet</div>
      {#each CONDS as c}
        <button class="mbtn cond" class:active={st.currentCond === c.id} onclick={() => setCond(c.id)}>{c.label}</button>
      {/each}
    </div>
  </div>

  <!-- GPS BUTTONS — always visible, separate pills -->
  <div id="stackGps">
    <button class="gps-pill" class:trk-on={st.tracking} title="GPS-seuranta"
      onpointerdown={e => lpStart(e, st.tracking ? 'GPS-seuranta: Stop' : 'GPS-seuranta')}
      onpointerup={lpEnd} onpointercancel={lpEnd} onclick={toggleTracking}
    >{@html st.tracking ? IC.stop : IC.sat}</button>
    <button class="gps-pill" title="Sijaintini"
      onpointerdown={e => lpStart(e, 'Sijaintini')}
      onpointerup={lpEnd} onpointercancel={lpEnd} onclick={locateOnce}
    >{@html IC.pin}</button>
    <button class="gps-pill" title="Kumoa"
      onpointerdown={e => lpStart(e, 'Kumoa')}
      onpointerup={lpEnd} onpointercancel={lpEnd} onclick={undoLast}
    >{@html IC.undo}</button>
    <button class="gps-pill" title="Tyhjennä" style="color:var(--red)"
      onpointerdown={e => lpStart(e, 'Tyhjennä')}
      onpointerup={lpEnd} onpointercancel={lpEnd} onclick={clearAll}
    >{@html IC.trash}</button>
  </div>
  {#if lpVisible}
    <div class="lp-tooltip" style="left:{lpPos.x}px; top:{lpPos.y}px">{lpLabel}</div>
  {/if}

  <!-- ACTION PILL -->
  <div class="pill" id="stackAction">
    <button class="toggle-btn" onclick={() => st.openMenu = st.openMenu === 'action' ? null : 'action'}>{@html actionIcon}</button>
    <div class="collapse-menu" class:open={st.openMenu === 'action'}>
      <button class="abtn" class:a-draw={st.activeDrawMode === 'draw'} onclick={toggleDraw}><span class="ai">{@html IC.pencil}</span>Piirrä pisteitä</button>
      <button class="abtn" class:a-free={st.activeDrawMode === 'freehand'} onclick={toggleFreehand}><span class="ai">{@html IC.pen}</span>Vapaa piirto</button>
      <button class="abtn" class:a-route={st.activeDrawMode === 'routing'} onclick={toggleRouting}><span class="ai">{@html IC.nav}</span>Reititä</button>
      {#if st.activeDrawMode === 'routing' && showLoopConf}
        <button class="abtn" onclick={closeLoop}><span class="ai">{@html IC.loop}</span>Sulje ympyrä</button>
        <button class="abtn" onclick={confirmRoute}><span class="ai">{@html IC.check}</span>Valmis</button>
      {/if}
      <button class="abtn" class:a-edit={st.activeDrawMode === 'edit'}
        onclick={toggleEdit}
        style={!canEdit ? 'opacity:.4;cursor:not-allowed' : ''}
      ><span class="ai">{@html IC.move}</span>Muokkaa reittiä</button>
      <button class="abtn" onclick={() => fileInput.click()}><span class="ai">{@html IC.folder}</span>Avaa GPX</button>
      {#if hasTrack}
        <button class="abtn" onclick={() => doExportGPX('track')}><span class="ai">{@html IC.export}</span>Vie tallenne</button>
      {/if}
      {#if hasRoute}
        <button class="abtn" onclick={() => doExportGPX('route')}><span class="ai">{@html IC.export}</span>Vie reitti</button>
      {/if}
    </div>
  </div>

  <input type="file" bind:this={fileInput} accept=".gpx,.xml,*/*" style="display:none" onchange={doImportGPX}>

  <!-- Indicators -->
  <div id="drawInd"  class="indicator" class:vis={st.activeDrawMode === 'draw'}>Napauta karttaan lisätäksesi pisteitä</div>
  <div id="freeInd"  class="indicator" class:vis={st.activeDrawMode === 'freehand'}>Piirrä sormella — vapauta lopettaaksesi</div>
  <div id="editInd"  class="indicator" class:vis={st.activeDrawMode === 'edit'}>Vedä ankkuripisteitä — reitin muokkaus</div>
  <div id="routeInd" class="indicator route-ind-wrap" class:vis={st.activeDrawMode === 'routing'}>
    <span>{routeIndText}</span>
    {#if showUseLoc}<button id="btnUseLocation" onclick={useLocationAsStart}>📍 Sijaintini</button>{/if}
  </div>

  <!-- Track Overlay -->
  {#if st.tracking}
    <div id="trackOverlay" class="vis">
      <div class="ttitle"><div class="ldot2"></div> Live-seuranta</div>
      <div class="trow"><span>Kuljettu</span><span>{fmtDist(trkDist(st.trackPts))}</span></div>
      <div class="trow"><span>Aika</span><span>{trkTimeStr}</span></div>
      <div class="trow"><span>Nopeus</span><span>{trkSpeedVal}</span></div>
      <div class="trow"><span>Tarkkuus</span><span>{trkAccVal}</span></div>
    </div>
  {/if}

  {#if st.tracking}
    <button id="centerToggle" class="vis" class:locked={st.centerLocked} onclick={toggleCenter}>
      {st.centerLocked ? '🔒 Seuraa sijaintia' : '🔓 Vapaa kartta'}
    </button>
  {/if}

  {#if spinning}
    <div id="spinner" class="vis"><span class="spin" style="display:flex">{@html IC.nav}</span> Haetaan reittiä…</div>
  {/if}

  <div id="toast" class:show={st.toastVisible}>{st.toastMsg}</div>
</div>
