<script>
  import * as st from '../state.svelte.js'
  import { showToast } from '../state.svelte.js'

  let { onToggleTracking, onLocateOnce, onUndo, onClearAll } = $props()

  function toggle() {
    st.openMenu === 'gps' ? (st.openMenu = null) : (st.openMenu = 'gps')
  }
</script>

<div class="pill" id="stackGps">
  <button class="toggle-btn" onclick={toggle}>🛰️</button>
  <div class="collapse-menu" class:open={st.openMenu === 'gps'} id="gpsMenu">
    <button class="ico-btn" class:trk-on={st.tracking} id="fabTrack" onclick={onToggleTracking}>
      {st.tracking ? '⏹️' : '🛰️'} GPS-seuranta
    </button>
    <button class="ico-btn" onclick={onLocateOnce}>📍 Sijaintini</button>
    <button class="ico-btn" onclick={onUndo}>↩️ Kumoa</button>
    <button class="ico-btn" onclick={onClearAll} style="color:var(--red)">🗑️ Tyhjennä</button>
  </div>
</div>
