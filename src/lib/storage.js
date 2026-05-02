import L from 'leaflet'
import { TRACK_AGE_MS } from './utils.js'

const SKEY = 'retkikartta_track';

export function saveTrack(trackPts, trackStart) {
  if (!trackPts.length) return;
  try {
    localStorage.setItem(SKEY, JSON.stringify({
      start: trackStart,
      saved: Date.now(),
      points: trackPts.map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6), p.ele ?? null])
    }));
  } catch (e) {}
}

export function clearTrackStorage() {
  try { localStorage.removeItem(SKEY); } catch (e) {}
}

export function loadTrack() {
  try {
    const raw = localStorage.getItem(SKEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - d.saved > TRACK_AGE_MS) { localStorage.removeItem(SKEY); return null; }
    if (!d.points || d.points.length < 2) return null;
    const pts = d.points.map(p => {
      const ll = L.latLng(p[0], p[1]);
      ll.ele = p[2] ?? null;
      return ll;
    });
    return { pts, start: d.start };
  } catch (e) { return null; }
}
