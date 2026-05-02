export const HISTORY_LIMIT       = 40;
export const RDP_EPSILON         = 0.0003;
export const ELE_SAMPLE_MAX      = 100;
export const TRACK_AGE_MS        = 86400000;
export const GPS_MIN_INTERVAL_MS = 10000;

export const SPEEDS     = { walk: 4.5, dog: 3.5, run: 9.0 };
export const COND_COEFF = { summer: 1.0, autumn: 0.85, crust: 0.75, snow30: 0.55, snow60: 0.35 };
export const COND_LABEL = { summer: '☀️ Kesä', autumn: '🍂 Syksy', crust: '❄️ Hanki', snow30: '🌨️ Lumi <30cm', snow60: '🌨️ Lumi >30cm' };
export const MODE_ICONS = { walk: '🚶', dog: '🐕', run: '🏃' };

export function haversine(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function toblerSpeed(slope, base) {
  const ref = 6 * Math.exp(-3.5 * Math.abs(0.05));
  return base * (6 * Math.exp(-3.5 * Math.abs(slope + 0.05)) / ref);
}

export function fmtMins(m) {
  return m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}min` : Math.round(m) + 'min';
}

export function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = ptld(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  return maxD > eps
    ? [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)]
    : [pts[0], pts[pts.length - 1]];
}

function ptld(p, a, b) {
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  if (!dx && !dy) return haversine(p, a);
  const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy);
  return haversine(p, { lat: a.lat + t * dy, lng: a.lng + t * dx });
}

export function catmull(pts) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    for (let t = 0; t < 1; t += 0.125) {
      const t2 = t * t, t3 = t2 * t;
      out.push({ lat: 0.5 * ((2 * p1.lat) + (-p0.lat + p2.lat) * t + (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 + (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3), lng: 0.5 * ((2 * p1.lng) + (-p0.lng + p2.lng) * t + (2 * p0.lng - 5 * p1.lng + 4 * p2.lng - p3.lng) * t2 + (-p0.lng + 3 * p1.lng - 3 * p2.lng + p3.lng) * t3) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function trkDist(trackPts) {
  let d = 0;
  for (let i = 1; i < trackPts.length; i++) d += haversine(trackPts[i - 1], trackPts[i]);
  return d;
}

export function calcDist(waypoints) {
  let d = 0;
  for (let i = 1; i < waypoints.length; i++) d += haversine(waypoints[i - 1], waypoints[i]);
  return d;
}

export function fmtDist(d) {
  return d < 1 ? (d * 1000).toFixed(0) + ' m' : d.toFixed(2) + ' km';
}

export function fmtTrkTime(startMs) {
  if (!startMs) return '0:00';
  const e = Math.floor((Date.now() - startMs) / 1000);
  const h = Math.floor(e / 3600), m = Math.floor((e % 3600) / 60), s = e % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
