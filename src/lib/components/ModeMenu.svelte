<script>
  import * as st from '../state.svelte.js'
  import { showToast } from '../state.svelte.js'
  import { COND_COEFF, COND_LABEL, MODE_ICONS } from '../utils.js'

  const modes = [
    { id: 'walk', label: '🚶 Kävely' },
    { id: 'dog',  label: '🐕 Koira' },
    { id: 'run',  label: '🏃 Juoksu' },
  ]
  const conds = [
    { id: 'summer', label: '☀️ Kesä / kuiva' },
    { id: 'autumn', label: '🍂 Syksy / märkä' },
    { id: 'crust',  label: '❄️ Talvi / hanki' },
    { id: 'snow30', label: '🌨️ Lumi <30 cm' },
    { id: 'snow60', label: '🌨️ Lumi >30 cm' },
  ]

  function toggle() {
    st.openMenu === 'mode' ? (st.openMenu = null) : (st.openMenu = 'mode')
  }

  function setMode(m) {
    st.currentMode = m
    if (m !== 'run') st.openMenu = null
    showToast({ walk: '🚶 Kävelytila', dog: '🐕 Koiratila', run: '🏃 Juoksutila' }[m])
  }

  function setCond(c) {
    st.currentCond = c
    st.openMenu = null
    if (c !== 'summer') showToast(COND_LABEL[c] + ' — hidastuskerroin ' + (COND_COEFF[c] * 100).toFixed(0) + '%')
    else showToast('☀️ Kesäolosuhteet')
  }

  function onSpeedInput(e) {
    st.runSpeed = parseFloat(e.target.value)
  }
</script>

<div class="pill" id="stackMode">
  <button class="toggle-btn" id="modeToggle" onclick={toggle}>
    {MODE_ICONS[st.currentMode]}
  </button>
  <div class="collapse-menu" class:open={st.openMenu === 'mode'}>
    {#each modes as m}
      <button class="mbtn" class:active={st.currentMode === m.id} onclick={() => setMode(m.id)}>
        {m.label}
      </button>
    {/each}

    {#if st.currentMode === 'run'}
      <div id="speedPanel">
        <div class="speed-label">Juoksuvauhti tasamaalla</div>
        <div class="speed-row">
          <input type="range" id="runSpeed" min="4" max="20" step="0.5"
            value={st.runSpeed} oninput={onSpeedInput}>
          <span class="speed-val">{st.runSpeed.toFixed(1)} km/h</span>
        </div>
      </div>
    {/if}

    <div class="cond-divider">Maasto-olosuhteet</div>
    {#each conds as c}
      <button class="mbtn cond" class:active={st.currentCond === c.id} onclick={() => setCond(c.id)}>
        {c.label}
      </button>
    {/each}
  </div>
</div>
