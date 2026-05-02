// ═══════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════
const map = L.map('map', { center:[62.5,25.7], zoom:6, zoomControl:true, attributionControl:false });

const MML_KEY  = '113f9471-0872-42fa-9fe7-cbedae6572b8';
const MML_BASE = 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0';
const GH_KEY   = 'e379a544-f2a3-4ad2-93c0-a2b43ce9047a';

const LAYERS = {
  osm:       L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,subdomains:'abc'}),
  mml:       L.tileLayer(MML_BASE+'/maastokartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key='+MML_KEY,{maxZoom:18}),
  topo:      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,subdomains:'abc'}),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19}),
  ortho:     L.tileLayer(MML_BASE+'/ortokuva/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png?api-key='+MML_KEY,{maxZoom:19}),
  hiking:    L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',{maxZoom:19,opacity:.8})
};
const BASE = ['osm','mml','topo','satellite','ortho'];
let activeBase='osm', hikeOn=false;
let layerMenuOpen=false, modeMenuOpen=false, gpsMenuOpen=false, actionMenuOpen=false;

function closeAllMenus() {
  if (layerMenuOpen)  { layerMenuOpen=false;  document.getElementById('layerMenu').classList.remove('open'); }
  if (modeMenuOpen)   { modeMenuOpen=false;   document.getElementById('modeMenu').classList.remove('open'); }
  if (gpsMenuOpen)    { gpsMenuOpen=false;    document.getElementById('gpsMenu').classList.remove('open'); }
  if (actionMenuOpen) { actionMenuOpen=false; document.getElementById('actionMenu').classList.remove('open'); }
}
function toggleLayerMenu()  { const o=layerMenuOpen;  closeAllMenus(); layerMenuOpen =!o; document.getElementById('layerMenu').classList.toggle('open',layerMenuOpen); }
function toggleModeMenu()   { const o=modeMenuOpen;   closeAllMenus(); modeMenuOpen  =!o; document.getElementById('modeMenu').classList.toggle('open',modeMenuOpen); }
function toggleGpsMenu()    { const o=gpsMenuOpen;    closeAllMenus(); gpsMenuOpen   =!o; document.getElementById('gpsMenu').classList.toggle('open',gpsMenuOpen); }
function toggleActionMenu() { const o=actionMenuOpen; closeAllMenus(); actionMenuOpen=!o; document.getElementById('actionMenu').classList.toggle('open',actionMenuOpen); }
LAYERS.osm.addTo(map);

function setLayer(name) {
  if (name==='hiking') {
    hikeOn=!hikeOn;
    hikeOn ? LAYERS.hiking.addTo(map) : map.removeLayer(LAYERS.hiking);
    if (hikeOn) LAYERS.hiking.bringToFront();
    document.getElementById('lbtn-hiking').classList.toggle('active', hikeOn);
    showToast(hikeOn?'🥾 Reittikorostus päällä':'🥾 Reittikorostus pois');
    return;
  }
  map.removeLayer(LAYERS[activeBase]);
  LAYERS[name].addTo(map);
  if (hikeOn) LAYERS.hiking.bringToFront();
  activeBase=name;
  BASE.forEach(l=>document.getElementById('lbtn-'+l).classList.toggle('active',l===name));
  closeAllMenus();
  if (waypoints.length>1) redraw();
  showToast({osm:'🗺️ OpenStreetMap',mml:'🇫🇮 MML Maastokartta',topo:'🏔️ Topokartta',satellite:'🛸 Satelliitti',ortho:'📷 MML Ortoilmakuva'}[name]);
}

function routeColor() {
  if (activeBase==='satellite'||activeBase==='ortho') return '#ffeb3b';
  if (activeBase==='topo'||activeBase==='mml') return '#e53935';
  return '#b07d2a';
}

// ═══════════════════════════════════════════════
// MODE & SPEED
// ═══════════════════════════════════════════════
const SPEEDS = { walk:4.5, dog:3.5, run:9.0 };
let currentMode = 'walk';

const MODE_ICONS = { walk:'🚶', dog:'🐕', run:'🏃' };

function setMode(m) {
  currentMode = m;
  ['walk','dog','run'].forEach(id=>{
    const el = document.getElementById('mode'+id.charAt(0).toUpperCase()+id.slice(1));
    if (el) el.classList.toggle('active', id===m);
  });
  document.getElementById('modeToggle').textContent = MODE_ICONS[m];
  document.getElementById('speedPanel').style.display = (m==='run') ? 'block' : 'none';
  if (m !== 'run') closeAllMenus();
  updateStats();
  showToast({walk:'🚶 Kävelytila',dog:'🐕 Koiratila',run:'🏃 Juoksutila'}[m]);
}
function onSpeedChange() {
  SPEEDS.run = parseFloat(document.getElementById('runSpeed').value);
  document.getElementById('runSpeedVal').textContent = SPEEDS.run.toFixed(1)+' km/h';
  updateStats();
}

// ── CONDITIONS ────────────────────────────────
const COND_COEFF = { summer:1.0, autumn:0.85, crust:0.75, snow30:0.55, snow60:0.35 };
const COND_LABEL = { summer:'☀️ Kesä', autumn:'🍂 Syksy', crust:'❄️ Hanki', snow30:'🌨️ Lumi <30cm', snow60:'🌨️ Lumi >30cm' };
let currentCond = 'summer';

function setCond(c) {
  currentCond = c;
  ['summer','autumn','crust','snow30','snow60'].forEach(id =>
    document.getElementById('cond-'+id).classList.toggle('active', id===c)
  );
  if (c !== 'summer') showToast(COND_LABEL[c]+' — hidastuskerroin '+(COND_COEFF[c]*100).toFixed(0)+'%');
  else showToast('☀️ Kesäolosuhteet');
  closeAllMenus();
  updateStats();
}

function baseSpeed() { return SPEEDS[currentMode] * COND_COEFF[currentCond] || 4.5; }

// ── VAKIOT ─────────────────────────────────────
const HISTORY_LIMIT       = 40;
const RDP_EPSILON         = 0.0003;
const ELE_SAMPLE_MAX      = 100;
const TRACK_AGE_MS        = 86400000;
const GPS_MIN_INTERVAL_MS = 10000;

// ═══════════════════════════════════════════════
// ROUTE STATE
// ═══════════════════════════════════════════════
let waypoints=[], wpTypes=[], segLines=[];
let history=[];

function rl(l){ if(l) try{map.removeLayer(l);}catch(e){} return null; }

function saveState() {
  history.push({ wp:waypoints.map(p=>L.latLng(p.lat,p.lng)), wt:[...wpTypes] });
  if (history.length > HISTORY_LIMIT) history.shift();
}
function undoLast() {
  if (!history.length){showToast('Ei kumottavaa');return;}
  const s=history.pop(); waypoints=s.wp; wpTypes=s.wt;
  redraw(); showToast('↩️ Kumottu');
}

function redraw() {
  segLines.forEach(l=>rl(l)); segLines=[];
  if (waypoints.length<2){updateStats();return;}
  const color=routeColor();
  let i=0;
  while (i<waypoints.length-1) {
    const type=wpTypes[i]||'drawn';
    let j=i+1;
    while(j<waypoints.length&&(wpTypes[j]||'drawn')===type)j++;
    const pts=waypoints.slice(i, j<waypoints.length?j+1:j);
    if (pts.length>1) segLines.push(L.polyline(pts,{color,weight:4,opacity:.9,lineJoin:'round',lineCap:'round',dashArray:type==='routed'?null:'10,6'}).addTo(map));
    i=j;
  }
  document.getElementById('btnExpRoute').style.display=waypoints.length>1?'':'none';
  updateStats(); scheduleEle();
}

// ═══════════════════════════════════════════════
// CLEAR
// ═══════════════════════════════════════════════
let gpsMarker=null,gpsCircle=null,trackLine=null,freehandLine=null,planGhost=null;

function clearAll() {
  if(drawing)  stopDraw();
  if(freehand) stopFreehand();
  if(routing)  cancelRouting();
  segLines.forEach(l=>rl(l)); segLines=[];
  gpsMarker=rl(gpsMarker); gpsCircle=rl(gpsCircle);
  trackLine=rl(trackLine); freehandLine=rl(freehandLine); planGhost=rl(planGhost);
  waypoints=[]; wpTypes=[]; history=[]; routeElevations=[]; plannedRoute=[]; trackPts=[];
  freehandPts=[]; freehandActive=false;
  clearTrackStorage();
  ['btnExpTrack','btnExpRoute'].forEach(id=>document.getElementById(id).style.display='none');
  ['statDist','statTime'].forEach(id=>document.getElementById(id).textContent='0');
  ['statUp','statDown','statEle'].forEach(id=>document.getElementById(id).textContent='– m');
  showToast('Kartta tyhjennetty');
}

// ═══════════════════════════════════════════════
// DRAWING (point by point)
// ═══════════════════════════════════════════════
let drawing=false;

function setActionIcon(icon) { document.getElementById('stackAction').querySelector('.toggle-btn').textContent = icon; }

function toggleDrawing() { drawing ? stopDraw() : startDraw(); }
function startDraw() {
  if(freehand)stopFreehand(); if(routing)cancelRouting();
  drawing=true;
  closeAllMenus();
  setActionIcon('✏️');
  document.getElementById('drawInd').classList.add('vis');
  document.getElementById('btnDraw').classList.add('a-draw');
  map.getContainer().style.cursor='crosshair';
  showToast('✏️ Napauta karttaan');
}
function stopDraw() {
  drawing=false;
  setActionIcon('✏️');
  document.getElementById('drawInd').classList.remove('vis');
  document.getElementById('btnDraw').classList.remove('a-draw');
  map.getContainer().style.cursor='';
}

map.on('click', e=>{ closeAllMenus(); if(drawing) addPt(e.latlng,'drawn'); else if(routing) addRoutePoint(e.latlng); });

function addPt(ll, type) {
  saveState(); waypoints.push(ll); wpTypes.push(type); redraw();
}

// ═══════════════════════════════════════════════
// FREEHAND
// ═══════════════════════════════════════════════
let freehand=false, freehandPts=[], freehandActive=false, freehandStarted=false;

function toggleFreehand() { freehand ? stopFreehand() : startFreehand(); }
function startFreehand() {
  if(drawing)stopDraw(); if(routing)cancelRouting();
  freehand=true;
  closeAllMenus();
  setActionIcon('🖊️');
  document.getElementById('freeInd').classList.add('vis');
  document.getElementById('btnFreehand').classList.add('a-free');
  showToast('🖊️ Piirrä sormella kartalle');
}
function stopFreehand() {
  freehand=false;
  setActionIcon('✏️');
  document.getElementById('freeInd').classList.remove('vis');
  document.getElementById('btnFreehand').classList.remove('a-free');
  map.dragging.enable(); map.getContainer().style.cursor='';
  cleanFH();
}
function cleanFH() { freehandLine=rl(freehandLine); freehandPts=[]; freehandActive=false; freehandStarted=false; }

function closestIdx(ll) {
  let best=0, bestD=Infinity;
  waypoints.forEach((p,i)=>{const d=haversine(ll,p);if(d<bestD){bestD=d;best=i;}});
  return best;
}
function spliceFH(pts) {
  if(pts.length<2)return;
  saveState();
  if(!waypoints.length){waypoints=pts;wpTypes=pts.map(()=>'drawn');redraw();showToast('✅ Vapaa reitti lisätty');return;}
  const si=closestIdx(pts[0]), ei=closestIdx(pts[pts.length-1]);
  const lo=Math.min(si,ei), hi=Math.max(si,ei);
  const ordered=si<=ei?pts:[...pts].reverse();
  waypoints=[...waypoints.slice(0,lo+1),...ordered,...waypoints.slice(hi)];
  wpTypes  =[...wpTypes.slice(0,lo+1),...ordered.map(()=>'drawn'),...wpTypes.slice(hi)];
  routeElevations=[];
  redraw(); showToast('✅ Osuus korvattu');
}

function rdp(pts,eps) {
  if(pts.length<3)return pts;
  let maxD=0,idx=0;
  for(let i=1;i<pts.length-1;i++){const d=ptld(pts[i],pts[0],pts[pts.length-1]);if(d>maxD){maxD=d;idx=i;}}
  return maxD>eps?[...rdp(pts.slice(0,idx+1),eps).slice(0,-1),...rdp(pts.slice(idx),eps)]:[pts[0],pts[pts.length-1]];
}
function ptld(p,a,b){const dx=b.lng-a.lng,dy=b.lat-a.lat;if(!dx&&!dy)return haversine(p,a);const t=((p.lng-a.lng)*dx+(p.lat-a.lat)*dy)/(dx*dx+dy*dy);return haversine(p,L.latLng(a.lat+t*dy,a.lng+t*dx));}

const mapEl=document.getElementById('map');
function fhStart(rx,ry){map.dragging.disable();freehandActive=true;freehandStarted=false;freehandPts=[];freehandLine=rl(freehandLine);freehandPts.push(map.containerPointToLatLng([rx,ry]));}
function fhMove(cx,cy){
  const r=mapEl.getBoundingClientRect(),rx=cx-r.left,ry=cy-r.top;
  const ll=map.containerPointToLatLng([rx,ry]),last=freehandPts[freehandPts.length-1];
  if(last&&haversine(last,ll)<0.015)return;
  freehandPts.push(ll); freehandStarted=freehandPts.length>=4;
  if(!freehandStarted)return;
  if(!freehandLine)freehandLine=L.polyline(freehandPts,{color:routeColor(),weight:4,opacity:.85,dashArray:'10,6',lineJoin:'round',lineCap:'round'}).addTo(map);
  else freehandLine.setLatLngs(freehandPts);
  const edge=60,spd=6;
  let dx=0,dy=0;
  if(rx<edge)dx=-Math.round((edge-rx)/edge*spd); else if(rx>r.width-edge)dx=Math.round((edge-(r.width-rx))/edge*spd);
  if(ry<edge)dy=-Math.round((edge-ry)/edge*spd); else if(ry>r.height-edge)dy=Math.round((edge-(r.height-ry))/edge*spd);
  if(dx||dy)map.panBy([dx,dy],{animate:false});
}
function fhEnd(){
  map.dragging.enable(); freehandActive=false;
  if(!freehandStarted||freehandPts.length<5){cleanFH();return;}
  let dist=0;for(let i=1;i<freehandPts.length;i++)dist+=haversine(freehandPts[i-1],freehandPts[i]);
  if(dist<0.03){cleanFH();return;}
  const simple=rdp(freehandPts, RDP_EPSILON);
  freehandLine=rl(freehandLine);
  spliceFH(simple); freehandPts=[]; freehandStarted=false;
}
mapEl.addEventListener('touchstart',e=>{if(!freehand)return;e.preventDefault();const t=e.touches[0],r=mapEl.getBoundingClientRect();fhStart(t.clientX-r.left,t.clientY-r.top);},{passive:false});
mapEl.addEventListener('touchmove', e=>{if(!freehand||!freehandActive)return;e.preventDefault();const t=e.touches[0];fhMove(t.clientX,t.clientY);},{passive:false});
mapEl.addEventListener('touchend',  e=>{if(!freehand||!freehandActive)return;e.preventDefault();fhEnd();},{passive:false});
mapEl.addEventListener('mousedown', e=>{if(!freehand||e.button!==0)return;const r=mapEl.getBoundingClientRect();fhStart(e.clientX-r.left,e.clientY-r.top);});
mapEl.addEventListener('mousemove', e=>{if(freehand&&freehandActive)fhMove(e.clientX,e.clientY);});
mapEl.addEventListener('mouseup',   e=>{if(freehand&&freehandActive)fhEnd();});

// ═══════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════
let routing=false, routeClickPts=[], routeMarkers=[], plannedRoute=[];

function toggleRouting(){routing?cancelRouting():startRouting();}
function startRouting(){
  if(drawing)stopDraw(); if(freehand)stopFreehand();
  routing=true; routeClickPts=[]; routeMarkers.forEach(m=>rl(m)); routeMarkers=[];
  closeAllMenus();
  setActionIcon('🧭');
  document.getElementById('routeIndText').textContent='🧭 Napauta lähtöpiste kartalle';
  document.getElementById('routeInd').classList.add('vis');
  document.getElementById('btnRoute').classList.add('a-route');
  document.getElementById('btnUseLocation').style.display='';
  map.getContainer().style.cursor='crosshair';
  if (navigator.geolocation) {
    if (confirm('Käytetäänkö nykyistä sijaintiasi lähtöpisteenä?')) {
      useLocationAsStart();
    }
  }
}
function cancelRouting(){
  routing=false; routeClickPts=[]; routeMarkers.forEach(m=>rl(m)); routeMarkers=[];
  setActionIcon('✏️');
  document.getElementById('routeInd').classList.remove('vis');
  document.getElementById('btnRoute').classList.remove('a-route');
  document.getElementById('btnUseLocation').style.display='none';
  ['btnCloseLoop','btnConfirm'].forEach(id=>document.getElementById(id).style.display='none');
  map.getContainer().style.cursor='';
}
function addRoutePoint(ll){
  routeClickPts.push(ll);
  const n=routeClickPts.length,isFirst=n===1;
  const icon=L.divIcon({className:'',html:`<div class="wp ${isFirst?'wp-s':'wp-m'}" style="${isFirst?'':'background:'+routeColor()}"></div>`,iconSize:[isFirst?18:14,isFirst?18:14],iconAnchor:[isFirst?9:7,isFirst?9:7]});
  routeMarkers.push(L.marker(ll,{icon}).addTo(map));
  if(n===1){
    document.getElementById('routeIndText').textContent='🧭 Napauta seuraava piste tai määränpää';
    document.getElementById('btnUseLocation').style.display='none';
  } else {
    document.getElementById('routeIndText').textContent=`🧭 ${n} pistettä — Valmis tai Ympyrä`;
    document.getElementById('btnCloseLoop').style.display='';
    document.getElementById('btnConfirm').style.display='';
  }
}

function useLocationAsStart(){
  showToast('Haetaan sijaintia…');
  navigator.geolocation.getCurrentPosition(pos=>{
    const ll=L.latLng(pos.coords.latitude,pos.coords.longitude);
    map.setView(ll,14);
    addRoutePoint(ll);
    showToast('📍 Sijaintisi lisätty lähtöpisteeksi');
  },()=>showToast('⚠️ Sijaintia ei löydy'),{enableHighAccuracy:true,timeout:10000});
}
async function confirmRoute(){await buildRoute([...routeClickPts]);}
async function closeLoop(){if(routeClickPts.length>=2)await buildRoute([...routeClickPts,routeClickPts[0]]);}
async function buildRoute(pts){
  if(pts.length<2){showToast('⚠️ Lisää vähintään 2 pistettä');return;}
  document.getElementById('spinner').classList.add('vis');
  try{
    const r=await fetch(`https://graphhopper.com/api/1/route?key=${GH_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:'foot',points:pts.map(p=>[+p.lng.toFixed(6),+p.lat.toFixed(6)]),points_encoded:false}),signal:AbortSignal.timeout(12000)});
    const j=await r.json();
    if(!r.ok)throw new Error(j?.message||'HTTP '+r.status);
    if(!j.paths?.length)throw new Error('Ei reittivaihtoehtoja');
    const path=j.paths[0];
    plannedRoute=path.points.coordinates.map(c=>{const ll=L.latLng(c[1],c[0]);ll.ele=c[2]??null;return ll;});
    saveState(); waypoints=plannedRoute; wpTypes=plannedRoute.map(()=>'routed'); routeElevations=[];
    redraw();
    if(segLines.length)map.fitBounds(segLines[0].getBounds(),{padding:[30,30]});
    const asc=Math.round(path.ascend??0),desc=Math.round(path.descend??0);
    if(asc||desc){document.getElementById('statUp').textContent='+'+asc+'m';document.getElementById('statDown').textContent='-'+desc+'m';}
    document.getElementById('btnExpRoute').style.display='';
    showToast(`🧭 ${(path.distance/1000).toFixed(2)} km löydetty`);
  }catch(e){showToast('⚠️ '+e.message.slice(0,100));}
  finally{document.getElementById('spinner').classList.remove('vis');cancelRouting();}
}

// ═══════════════════════════════════════════════
// STATS & ELEVATION
// ═══════════════════════════════════════════════
let routeElevations=[], eleTimer=null;

function haversine(a,b){const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lng-a.lng)*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function toblerSpeed(slope,base){const ref=6*Math.exp(-3.5*Math.abs(.05));return base*(6*Math.exp(-3.5*Math.abs(slope+.05))/ref);}
function fmtMins(m){return m>=60?`${Math.floor(m/60)}h ${Math.round(m%60)}min`:Math.round(m)+'min';}

function updateStats(){
  let dist=0;for(let i=1;i<waypoints.length;i++)dist+=haversine(waypoints[i-1],waypoints[i]);
  document.getElementById('statDist').textContent=dist<1?(dist*1000).toFixed(0)+' m':dist.toFixed(2)+' km';
  const spd=baseSpeed();
  if(routeElevations.length===waypoints.length&&waypoints.length>1){
    let hrs=0,up=0,dn=0;
    for(let i=1;i<waypoints.length;i++){const dkm=haversine(waypoints[i-1],waypoints[i]),dEle=(routeElevations[i]??0)-(routeElevations[i-1]??0),slope=dkm>0?dEle/(dkm*1000):0;hrs+=dkm/Math.max(toblerSpeed(slope,spd),.5);if(dEle>0)up+=dEle;else dn+=Math.abs(dEle);}
    document.getElementById('statTime').textContent=fmtMins(hrs*60);
    document.getElementById('statUp').textContent=up>0?'+'+Math.round(up)+'m':'0 m';
    document.getElementById('statDown').textContent=dn>0?'-'+Math.round(dn)+'m':'0 m';
  }else{
    document.getElementById('statTime').textContent=fmtMins((dist/spd)*60);
    if(waypoints.length>1){document.getElementById('statUp').textContent='…';document.getElementById('statDown').textContent='…';}
  }
}

function scheduleEle(){clearTimeout(eleTimer);if(waypoints.length>0)eleTimer=setTimeout(fetchEle,1200);}

async function fetchEle(){
  if(!waypoints.length)return;
  try{
    const pts=waypoints,max=ELE_SAMPLE_MAX;
    let sampled;
    if(pts.length<=max)sampled=pts.map((p,i)=>({p,i}));
    else{sampled=[];for(let s=0;s<max;s++){const i=Math.round(s*(pts.length-1)/(max-1));sampled.push({p:pts[i],i});}}
    const lats=sampled.map(({p})=>p.lat.toFixed(5)).join(','),lngs=sampled.map(({p})=>p.lng.toFixed(5)).join(',');
    const r=await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`,{signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error();
    const j=await r.json(),elevs=j.elevation;
    if(!elevs||elevs.length!==sampled.length)throw new Error();
    routeElevations=new Array(pts.length).fill(null);
    sampled.forEach(({i},si)=>routeElevations[i]=elevs[si]);
    for(let i=0;i<pts.length;i++){
      if(routeElevations[i]!==null)continue;
      const prev=sampled.filter(s=>s.i<=i).pop(),next=sampled.find(s=>s.i>=i);
      if(prev&&next&&prev.i!==next.i){const t=(i-prev.i)/(next.i-prev.i);routeElevations[i]=routeElevations[prev.i]+t*(routeElevations[next.i]-routeElevations[prev.i]);}
      else if(prev)routeElevations[i]=routeElevations[prev.i];
      else if(next)routeElevations[i]=routeElevations[next.i];
    }
    const last=routeElevations[routeElevations.length-1];
    if(last!==null)document.getElementById('statEle').textContent=Math.round(last)+' m';
    updateStats();
  }catch(e){}
}
async function fetchCurEle(ll){try{const r=await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${ll.lat.toFixed(5)}&longitude=${ll.lng.toFixed(5)}`,{signal:AbortSignal.timeout(5000)});const j=await r.json();const e=j.elevation?.[0];if(e!==undefined)document.getElementById('statEle').textContent=Math.round(e)+' m';}catch(e){}}

// ═══════════════════════════════════════════════
// GPS TRACKING
// ═══════════════════════════════════════════════
const SKEY='retkikartta_track';
const var_blue='#3478f6';
let tracking=false,watchId=null,trackPts=[],trackStart=null,trackTimer=null,centerLocked=true,lastGpsTime=0,wakeLock=null;

async function reqWL(){if(!('wakeLock'in navigator))return;try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>wakeLock=null);}catch(e){}}
function relWL(){if(wakeLock){wakeLock.release();wakeLock=null;}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&tracking)reqWL();});

function saveTrack(){if(!trackPts.length)return;try{localStorage.setItem(SKEY,JSON.stringify({start:trackStart,saved:Date.now(),points:trackPts.map(p=>[+p.lat.toFixed(6),+p.lng.toFixed(6),p.ele??null])}));}catch(e){}}
function clearTrackStorage(){try{localStorage.removeItem(SKEY);}catch(e){}}
function loadTrack(){
  try{
    const raw=localStorage.getItem(SKEY);if(!raw)return;
    const d=JSON.parse(raw);if(Date.now()-d.saved > TRACK_AGE_MS){localStorage.removeItem(SKEY);return;}
    if(!d.points||d.points.length<2)return;
    trackPts=d.points.map(p=>{const ll=L.latLng(p[0],p[1]);ll.ele=p[2]??null;return ll;});
    trackStart=d.start;
    trackLine=L.polyline(trackPts,{color:var_blue,weight:4,opacity:.85,lineJoin:'round',lineCap:'round'}).addTo(map);
    map.fitBounds(trackLine.getBounds(),{padding:[30,30]});
    document.getElementById('btnExpTrack').style.display='';
    showToast('📂 Edellinen reitti palautettu');
  }catch(e){}
}

function locateOnce(){
  showToast('Haetaan sijaintia…');
  navigator.geolocation.getCurrentPosition(pos=>{
    const ll=L.latLng(pos.coords.latitude,pos.coords.longitude);
    map.setView(ll,14); placeGpsDot(ll,pos.coords.accuracy);
    if(pos.coords.altitude!==null)document.getElementById('statEle').textContent=Math.round(pos.coords.altitude)+' m';
    else fetchCurEle(ll);
    showToast('📍 Sijainti löydetty!');
    if(drawing)addPt(ll,'drawn');
  },()=>showToast('⚠️ Sijaintia ei löydy'),{enableHighAccuracy:true,timeout:10000});
}

function toggleTracking(){tracking?stopTracking():startTracking();}
function startTracking(){
  if(!navigator.geolocation){showToast('⚠️ GPS ei tuettu');return;}
  tracking=true;trackPts=[];trackStart=Date.now();centerLocked=true;lastGpsTime=0;
  const btn=document.getElementById('fabTrack');btn.classList.add('trk-on');btn.textContent='⏹️';
  document.getElementById('trackOverlay').classList.add('vis');
  document.getElementById('centerToggle').classList.add('vis','locked');
  trackLine=rl(trackLine); clearTrackStorage(); reqWL();
  watchId=navigator.geolocation.watchPosition(onGps,()=>showToast('⚠️ GPS-virhe'),{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
  trackTimer=setInterval(updateTrkTime,1000);
  showToast('🛰️ GPS-seuranta käynnistetty');
}
function stopTracking(){
  if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}
  clearInterval(trackTimer);tracking=false;relWL();saveTrack();
  const btn=document.getElementById('fabTrack');btn.classList.remove('trk-on');btn.textContent='🛰️';
  document.getElementById('trackOverlay').classList.remove('vis');
  document.getElementById('centerToggle').classList.remove('vis');
  const d=trkDist();showToast(`⏹️ ${d<1?(d*1000).toFixed(0)+' m':d.toFixed(2)+' km'} tallennettu`);
}
function onGps(pos){
  const now=Date.now();if(now-lastGpsTime < GPS_MIN_INTERVAL_MS)return;lastGpsTime=now;
  const ll=L.latLng(pos.coords.latitude,pos.coords.longitude);ll.ele=pos.coords.altitude??null;
  placeGpsDot(ll,pos.coords.accuracy);trackPts.push(ll);
  if(ll.ele!==null)document.getElementById('statEle').textContent=Math.round(ll.ele)+' m';
  if(trackPts.length%10===0)saveTrack();
  document.getElementById('btnExpTrack').style.display=trackPts.length>1?'':'none';
  if(trackPts.length>1){
    const sm=catmull(trackPts);
    if(!trackLine)trackLine=L.polyline(sm,{color:var_blue,weight:4,opacity:.85,lineJoin:'round',lineCap:'round'}).addTo(map);
    else trackLine.setLatLngs(sm);
  }
  if(centerLocked)map.panTo(ll,{animate:true,duration:.5});
  const d=trkDist();
  document.getElementById('trkDist').textContent=d<1?(d*1000).toFixed(0)+' m':d.toFixed(2)+' km';
  document.getElementById('trkAcc').textContent=pos.coords.accuracy<10?'✅ '+pos.coords.accuracy.toFixed(0)+'m':pos.coords.accuracy.toFixed(0)+' m';
  const spd=pos.coords.speed;if(spd!==null&&spd>=0)document.getElementById('trkSpeed').textContent=(spd*3.6).toFixed(1)+' km/h';
}
function catmull(pts){if(pts.length<3)return pts;const out=[];for(let i=0;i<pts.length-1;i++){const p0=pts[Math.max(i-1,0)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(i+2,pts.length-1)];for(let t=0;t<1;t+=.125){const t2=t*t,t3=t2*t;out.push(L.latLng(.5*((2*p1.lat)+(-p0.lat+p2.lat)*t+(2*p0.lat-5*p1.lat+4*p2.lat-p3.lat)*t2+(-p0.lat+3*p1.lat-3*p2.lat+p3.lat)*t3),.5*((2*p1.lng)+(-p0.lng+p2.lng)*t+(2*p0.lng-5*p1.lng+4*p2.lng-p3.lng)*t2+(-p0.lng+3*p1.lng-3*p2.lng+p3.lng)*t3)));}}out.push(pts[pts.length-1]);return out;}
function placeGpsDot(ll,acc){gpsMarker=rl(gpsMarker);gpsCircle=rl(gpsCircle);if(acc&&acc<300)gpsCircle=L.circle(ll,{radius:acc,color:var_blue,fillColor:var_blue,fillOpacity:.07,weight:1,opacity:.35}).addTo(map);gpsMarker=L.marker(ll,{icon:L.divIcon({className:'',html:'<div class="gps-dot"></div>',iconSize:[16,16],iconAnchor:[8,8]}),zIndexOffset:1000}).addTo(map);}
function updateTrkTime(){if(!trackStart)return;const e=Math.floor((Date.now()-trackStart)/1000),h=Math.floor(e/3600),m=Math.floor((e%3600)/60),s=e%60;document.getElementById('trkTime').textContent=h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;}
function toggleCenter(){centerLocked=!centerLocked;const b=document.getElementById('centerToggle');b.classList.toggle('locked',centerLocked);b.textContent=centerLocked?'🔒 Seuraa sijaintia':'🔓 Vapaa kartta';if(centerLocked&&gpsMarker)map.panTo(gpsMarker.getLatLng());}
function trkDist(){let d=0;for(let i=1;i<trackPts.length;i++)d+=haversine(trackPts[i-1],trackPts[i]);return d;}

// ═══════════════════════════════════════════════
// GPX
// ═══════════════════════════════════════════════
function exportGPX(type){
  const pts=type==='track'?trackPts:waypoints;if(!pts.length){showToast('Ei pisteitä');return;}
  const name=type==='track'?'Kuljettu reitti':'Suunniteltu reitti',ts=new Date().toISOString().slice(0,19).replace(/[-:T]/g,'-');
  let inner='';
  if(type==='track')inner=`  <trk><name>${name}</name><trkseg>\n`+pts.map(p=>`    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${p.ele!=null?`<ele>${p.ele.toFixed(1)}</ele>`:''}</trkpt>`).join('\n')+'\n  </trkseg></trk>';
  else inner=`  <rte><name>${name}</name>\n`+pts.map((p,i)=>`    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${p.ele!=null?`<ele>${p.ele.toFixed(1)}</ele>`:''}<name>WP${i+1}</name></rtept>`).join('\n')+'\n  </rte>';
  const gpx=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Retkikartta" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${name}</name><time>${new Date().toISOString()}</time></metadata>\n${inner}\n</gpx>`;
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([gpx],{type:'application/gpx+xml'}));a.download=`retkikartta-${type}-${ts}.gpx`;document.body.appendChild(a);a.click();document.body.removeChild(a);
  showToast('⬇️ GPX ladattu!');
}
function importGPX(event){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const xml=new DOMParser().parseFromString(e.target.result,'application/xml'),ns='http://www.topografix.com/GPX/1/1';
      const pp=(nodes,tag)=>{const pts=[];nodes.forEach(seg=>Array.from(seg.getElementsByTagNameNS(ns,tag)).forEach(pt=>{const lat=parseFloat(pt.getAttribute('lat')),lng=parseFloat(pt.getAttribute('lon'));if(isNaN(lat)||isNaN(lng))return;const ll=L.latLng(lat,lng);const el=pt.getElementsByTagNameNS(ns,'ele')[0];ll.ele=el?parseFloat(el.textContent):null;pts.push(ll);}));return pts;};
      let pts=[],isTrk=false;
      const segs=Array.from(xml.getElementsByTagNameNS(ns,'trkseg'));
      if(segs.length){pts=pp(segs,'trkpt');isTrk=true;}
      if(!pts.length){const rtes=Array.from(xml.getElementsByTagNameNS(ns,'rte'));if(rtes.length)pts=pp(rtes,'rtept');}
      if(!pts.length)pts=pp([xml.documentElement],'wpt');
      if(!pts.length){showToast('⚠️ Ei pisteitä');return;}
      if(isTrk||pts.length>50){trackLine=rl(trackLine);trackPts=pts;trackLine=L.polyline(pts,{color:var_blue,weight:4,opacity:.85,lineJoin:'round',lineCap:'round'}).addTo(map);map.fitBounds(trackLine.getBounds(),{padding:[30,30]});document.getElementById('btnExpTrack').style.display='';}
      else{saveState();waypoints=pts;wpTypes=pts.map(()=>'drawn');redraw();if(segLines.length)map.fitBounds(segLines[0].getBounds(),{padding:[30,30]});}
      const nm=xml.getElementsByTagNameNS(ns,'name')[0];showToast(`📂 ${nm?nm.textContent.trim():file.name} (${pts.length} pistettä)`);
    }catch(err){showToast('⚠️ GPX-virhe');}
    event.target.value='';
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════
// TOAST & INIT
// ═══════════════════════════════════════════════
let toastTimer;
function showToast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2500);}

if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
document.getElementById('speedPanel').style.display = 'none';
loadTrack();
showToast('Tervetuloa Retkikarttaan! 🌲');
