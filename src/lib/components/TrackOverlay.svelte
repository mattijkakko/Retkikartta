<script>
  import { tracking, trackPts, trackStart } from '../state.svelte.js'
  import { trkDist, fmtDist, fmtTrkTime } from '../utils.js'

  let trkSpeed = $state('0.0 km/h')
  let trkAcc   = $state('–')

  export function updateSpeed(speed) { trkSpeed = speed }
  export function updateAcc(acc) { trkAcc = acc }
</script>

{#if tracking}
<div id="trackOverlay" class="vis">
  <div class="ttitle"><div class="ldot2"></div> Live-seuranta</div>
  <div class="trow"><span>Kuljettu</span><span>{fmtDist(trkDist(trackPts))}</span></div>
  <div class="trow"><span>Aika</span><span>{fmtTrkTime(trackStart)}</span></div>
  <div class="trow"><span>Nopeus</span><span>{trkSpeed}</span></div>
  <div class="trow"><span>Tarkkuus</span><span>{trkAcc}</span></div>
</div>
{/if}
