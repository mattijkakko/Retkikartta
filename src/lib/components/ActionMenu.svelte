<script>
  import * as st from '../state.svelte.js'

  let {
    onToggleDraw, onToggleFreehand, onToggleRouting,
    onCloseLoop, onConfirmRoute, onExportGPX, onImportGPX,
    hasTrack, hasRoute
  } = $props()

  let fileInput = $state(null)

  function toggle() {
    st.openMenu === 'action' ? (st.openMenu = null) : (st.openMenu = 'action')
  }

  const actionIcon = $derived(
    st.activeDrawMode === 'freehand' ? '🖊️'
    : st.activeDrawMode === 'routing' ? '🧭'
    : '✏️'
  )
</script>

<div class="pill" id="stackAction">
  <button class="toggle-btn" onclick={toggle}>{actionIcon}</button>
  <div class="collapse-menu" class:open={st.openMenu === 'action'} id="actionMenu">
    <button class="abtn" class:a-draw={st.activeDrawMode === 'draw'} id="btnDraw" onclick={onToggleDraw}>
      <span class="ai">✏️</span>Piirrä pisteitä
    </button>
    <button class="abtn" class:a-free={st.activeDrawMode === 'freehand'} id="btnFreehand" onclick={onToggleFreehand}>
      <span class="ai">🖊️</span>Vapaa piirto
    </button>
    <button class="abtn" class:a-route={st.activeDrawMode === 'routing'} id="btnRoute" onclick={onToggleRouting}>
      <span class="ai">🧭</span>Reititä
    </button>
    {#if st.activeDrawMode === 'routing'}
      <button class="abtn" id="btnCloseLoop" onclick={onCloseLoop}>
        <span class="ai">🔄</span>Sulje ympyrä
      </button>
      <button class="abtn" id="btnConfirm" onclick={onConfirmRoute}>
        <span class="ai">✅</span>Valmis
      </button>
    {/if}
    <button class="abtn" onclick={() => fileInput.click()}>
      <span class="ai">📂</span>Avaa GPX
    </button>
    {#if hasTrack}
      <button class="abtn" id="btnExpTrack" onclick={() => onExportGPX('track')}>
        <span class="ai">⬇️</span>Vie tallenne
      </button>
    {/if}
    {#if hasRoute}
      <button class="abtn" id="btnExpRoute" onclick={() => onExportGPX('route')}>
        <span class="ai">⬇️</span>Vie reitti
      </button>
    {/if}
  </div>
</div>

<input type="file" bind:this={fileInput} accept=".gpx,.xml,*/*" style="display:none"
  onchange={onImportGPX}>
