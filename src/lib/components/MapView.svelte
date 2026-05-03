<script>
  import { onMount, onDestroy } from 'svelte'
  import L from 'leaflet'
  import { st, showToast } from '../state.svelte.js'
  import { haversine, rdp, catmull, trkDist, fmtDist, RDP_EPSILON, HISTORY_LIMIT, GPS_MIN_INTERVAL_MS, COND_COEFF, COND_LABEL, MODE_ICONS } from '../utils.js'
  import { fetchRoute, fetchElevation, fetchSingleElevation } from '../api.js'
  import { exportGPX, parseGPX } from '../gpx.js'
  import { saveTrack, clearTrackStorage, loadTrack } from '../storage.js'

  const MML_KEY  = '113f9471-0872-42fa-9fe7-cbedae6572b8'
  const MML_BASE = 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0'
  const VAR_BLUE = '#3478f6'
  const LAYER_TOASTS = { osm:'🗺️ OpenStreetMap', mml:'🇫🇮 MML Maastokartta', topo:'🏔️ Topokartta', satellite:'🛸 Satelliitti', ortho:'📷 MML Ortoilmakuva' }

  let mapEl = $state(null)
  let fileInput = $state(null)
  let map, LAYERS

  let segLines = [], gpsMarker = null, gpsCircle = null
  let trackLine = null, freehandLine = null
  let routeClickPts = [], routeMarkers = []
  let freehandPts = [], freehandActive = false, freehandStarted = false
  let watchId = null, trackTimer = null, wakeLock = null, lastGpsTime = 0, eleTimer = null

  let routeIndText  = $state('🧭 Napauta lähtöpiste kartalle')
  let showUseLoc    = $state(false)
  let showLoopConf  = $state(false)
  let spinning      = $state(false)
  let trkSpeedVal   = $state('0.0 km/h')
  let trkAccVal     = $state('–')
  let trkTimeStr    = $state('0:00')

  const hasTrack = $derived(st.trackPts.length > 1)
  const hasRoute = $derived(st.waypoints.length > 1)
  const actionIcon = $derived(st.activeDrawMode === 'freehand' ? '🖊️' : st.activeDrawMode === 'routing' ? '🧭' : '✏️')

  function rl(l) { if (l) try { map.removeLayer(l) } catch(e){} return null }

  function routeColor() {
    if (st.activeBase === 'satellite' || st.activeBase === 'ortho') return '#ffeb3b'
    if (st.activeBase === 'topo'     || st.activeBase === 'mml')    return '#e53935'
    return '#b07d2a'
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
    if (st.history.length > HISTORY_LIMIT) st.history.shift()
  }

  function redraw() {
    segLines.forEach(l => rl(l)); segLines = []
    if (st.waypoints.length < 2) return
    const color = routeColor()
    let i = 0
    while (i < st.waypoints.length - 1) {
      const type = st.wpTypes[i] || 'drawn'
      let j = i + 1
      while (j < st.waypoints.length && (st.wpTypes[j] || 'drawn') === type) j++
      const pts = st.waypoints.slice(i, j < st.waypoints.length ? j + 1 : j)
      if (pts.length > 1) segLines.push(L.polyline(pts, { color, weight: 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round', dashArray: type === 'routed' ? null : '10,6' }).addTo(map))
      i = j
    }
    scheduleEle()
  }

  function addPt(ll, type) { saveRouteState(); st.waypoints = [...st.waypoints, ll]; st.wpTypes = [...st.wpTypes, type]; redraw() }

  function undoLast() {
    if (!st.history.length) { showToast('Ei kumottavaa'); return }
    const s = st.history.pop(); st.waypoints = s.wp; st.wpTypes = s.wt; redraw(); showToast('↩️ Kumottu')
  }

  function clearAll() {
    stopDraw(); stopFreehand(); cancelRouting()
    segLines.forEach(l => rl(l)); segLines = []
    gpsMarker = rl(gpsMarker); gpsCircle = rl(gpsCircle); trackLine = rl(trackLine); freehandLine = rl(freehandLine)
    st.waypoints = []; st.wpTypes = []; st.history = []; st.routeElevations = []; st.trackPts = []
    freehandPts = []; clearTrackStorage(); st.currentEle = '– m'; showToast('Kartta tyhjennetty')
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

  function closestIdx(ll) {
    let best = 0, bestD = Infinity
    st.waypoints.forEach((p, i) => { const d = haversine(ll, p); if (d < bestD) { bestD = d; best = i } })
    return best
  }
  function spliceFH(pts) {
    if (pts.length < 2) return; saveRouteState()
    if (!st.waypoints.length) { st.waypoints = pts; st.wpTypes = pts.map(() => 'drawn'); redraw(); showToast('✅ Vapaa reitti lisätty'); return }
    const si = closestIdx(pts[0]), ei = closestIdx(pts[pts.length - 1])
    const lo = Math.min(si, ei), hi = Math.max(si, ei)
    const ordered = si <= ei ? pts : [...pts].reverse()
    st.waypoints = [...st.waypoints.slice(0, lo + 1), ...ordered, ...st.waypoints.slice(hi)]
    st.wpTypes   = [...st.wpTypes.slice(0, lo + 1), ...ordered.map(() => 'drawn'), ...st.wpTypes.slice(hi)]
    st.routeElevations = []; redraw(); showToast('✅ Osuus korvattu')
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
    showUseLoc = false; showLoopConf = false; map.getContainer().style.cursor = ''
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
      saveRouteState(); st.waypoints = routed; st.wpTypes = routed.map(() => 'routed'); st.routeElevations = []
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
        if (isTrk || pts.length > 50) {
          trackLine = rl(trackLine); st.trackPts = pts
          trackLine = L.polyline(pts, { color: VAR_BLUE, weight: 4, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }).addTo(map)
          map.fitBounds(trackLine.getBounds(), { padding: [30, 30] })
        } else {
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
      osm:       L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, subdomains: 'abc' }),
      mml:       L.tileLayer(`${MML_BASE}/maastokartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key=${MML_KEY}`, { maxZoom: 18 }),
      topo:      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, subdomains: 'abc' }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
      ortho:     L.tileLayer(`${MML_BASE}/ortokuva/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key=${MML_KEY}`, { maxZoom: 19 }),
      hiking:    L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', { maxZoom: 19, opacity: 0.8 })
    }
    map = L.map(mapEl, { center: [62.5, 25.7], zoom: 6, zoomControl: true, attributionControl: false })
    LAYERS.osm.addTo(map); map.on('click', onMapClick)
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
    { id: 'osm',       label: 'OpenStreetMap' },
    { id: 'mml',       label: 'MML Maasto' },
    { id: 'topo',      label: 'Topokartta' },
    { id: 'satellite', label: 'Satelliitti' },
    { id: 'ortho',     label: 'MML Ilmakuva' },
    { id: 'hiking',    label: '+ Reitit' },
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

  <!-- LAYER PILL -->
  <div class="pill" id="stackLayer">
    <button class="layer-toggle" onclick={() => st.openMenu = st.openMenu === 'layer' ? null : 'layer'} title="Karttapohja">🗺️</button>
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
    <button class="gps-pill" class:trk-on={st.tracking} onclick={toggleTracking}>
      {st.tracking ? '⏹️' : '🛰️'} {st.tracking ? 'Stop' : 'GPS-seuranta'}
    </button>
    <button class="gps-pill" onclick={locateOnce}>📍 Sijaintini</button>
    <button class="gps-pill" onclick={undoLast}>↩️ Kumoa</button>
    <button class="gps-pill" onclick={clearAll} style="color:var(--red)">🗑️ Tyhjennä</button>
  </div>

  <!-- ACTION PILL -->
  <div class="pill" id="stackAction">
    <button class="toggle-btn" onclick={() => st.openMenu = st.openMenu === 'action' ? null : 'action'}>{actionIcon}</button>
    <div class="collapse-menu" class:open={st.openMenu === 'action'}>
      <button class="abtn" class:a-draw={st.activeDrawMode === 'draw'} onclick={toggleDraw}><span class="ai">✏️</span>Piirrä pisteitä</button>
      <button class="abtn" class:a-free={st.activeDrawMode === 'freehand'} onclick={toggleFreehand}><span class="ai">🖊️</span>Vapaa piirto</button>
      <button class="abtn" class:a-route={st.activeDrawMode === 'routing'} onclick={toggleRouting}><span class="ai">🧭</span>Reititä</button>
      {#if st.activeDrawMode === 'routing' && showLoopConf}
        <button class="abtn" onclick={closeLoop}><span class="ai">🔄</span>Sulje ympyrä</button>
        <button class="abtn" onclick={confirmRoute}><span class="ai">✅</span>Valmis</button>
      {/if}
      <button class="abtn" onclick={() => fileInput.click()}><span class="ai">📂</span>Avaa GPX</button>
      {#if hasTrack}
        <button class="abtn" onclick={() => doExportGPX('track')}><span class="ai">⬇️</span>Vie tallenne</button>
      {/if}
      {#if hasRoute}
        <button class="abtn" onclick={() => doExportGPX('route')}><span class="ai">⬇️</span>Vie reitti</button>
      {/if}
    </div>
  </div>

  <input type="file" bind:this={fileInput} accept=".gpx,.xml,*/*" style="display:none" onchange={doImportGPX}>

  <!-- Indicators -->
  <div id="drawInd"  class="indicator" class:vis={st.activeDrawMode === 'draw'}>✏️ Napauta karttaan lisätäksesi pisteitä</div>
  <div id="freeInd"  class="indicator" class:vis={st.activeDrawMode === 'freehand'}>🖊️ Piirrä sormella — vapauta lopettaaksesi</div>
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
    <div id="spinner" class="vis"><span class="spin">⏳</span> Haetaan reittiä…</div>
  {/if}

  <div id="toast" class:show={st.toastVisible}>{st.toastMsg}</div>
</div>
