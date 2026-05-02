import L from 'leaflet'

const NS = 'http://www.topografix.com/GPX/1/1';

export function exportGPX(pts, type) {
  if (!pts.length) return null;
  const name = type === 'track' ? 'Kuljettu reitti' : 'Suunniteltu reitti';
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '-');
  let inner = '';
  if (type === 'track') {
    inner = `  <trk><name>${name}</name><trkseg>\n` +
      pts.map(p => `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}</trkpt>`).join('\n') +
      '\n  </trkseg></trk>';
  } else {
    inner = `  <rte><name>${name}</name>\n` +
      pts.map((p, i) => `    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}<name>WP${i + 1}</name></rtept>`).join('\n') +
      '\n  </rte>';
  }
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Retkikartta" xmlns="${NS}">\n  <metadata><name>${name}</name><time>${new Date().toISOString()}</time></metadata>\n${inner}\n</gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `retkikartta-${type}-${ts}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function parseGPX(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  const pp = (nodes, tag) => {
    const pts = [];
    nodes.forEach(seg =>
      Array.from(seg.getElementsByTagNameNS(NS, tag)).forEach(pt => {
        const lat = parseFloat(pt.getAttribute('lat'));
        const lng = parseFloat(pt.getAttribute('lon'));
        if (isNaN(lat) || isNaN(lng)) return;
        const ll = L.latLng(lat, lng);
        const el = pt.getElementsByTagNameNS(NS, 'ele')[0];
        ll.ele = el ? parseFloat(el.textContent) : null;
        pts.push(ll);
      })
    );
    return pts;
  };

  let pts = [], isTrk = false;
  const segs = Array.from(xml.getElementsByTagNameNS(NS, 'trkseg'));
  if (segs.length) { pts = pp(segs, 'trkpt'); isTrk = true; }
  if (!pts.length) {
    const rtes = Array.from(xml.getElementsByTagNameNS(NS, 'rte'));
    if (rtes.length) pts = pp(rtes, 'rtept');
  }
  if (!pts.length) pts = pp([xml.documentElement], 'wpt');

  const nm = xml.getElementsByTagNameNS(NS, 'name')[0];
  return { pts, isTrk, name: nm ? nm.textContent.trim() : null };
}
