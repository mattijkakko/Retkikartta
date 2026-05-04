<script>
  import { openMenu, activeBase, hikeOn, showToast } from '../state.svelte.js'
  import * as st from '../state.svelte.js'

  const layers = [
    { id: 'osm',       label: 'OpenStreetMap' },
    { id: 'mml',       label: 'MML Maasto' },
    { id: 'topo',      label: 'Topokartta' },
    { id: 'satellite', label: 'Satelliitti' },
    { id: 'ortho',     label: 'MML Ilmakuva' },
    { id: 'hiking',    label: '+ Reitit' },
  ]

  const TOAST = { osm:'🗺️ OpenStreetMap', mml:'🇫🇮 MML Maastokartta', topo:'🏔️ Topokartta', satellite:'🌐 Satelliitti', ortho:'📷 MML Ortoilmakuva' }

  let { onSetLayer } = $props()

  function toggle() {
    openMenu === 'layer' ? (st.openMenu = null) : (st.openMenu = 'layer')
  }

  function setLayer(name) {
    onSetLayer(name)
    if (name !== 'hiking') st.openMenu = null
    showToast(name === 'hiking'
      ? (hikeOn ? '🥾 Reittikorostus päällä' : '🥾 Reittikorostus pois')
      : TOAST[name])
  }
</script>

<div class="pill" id="stackLayer">
  <button class="layer-toggle" onclick={toggle} title="Karttapohja">🗺️</button>
  <div class="layer-menu" class:open={openMenu === 'layer'}>
    {#each layers as l}
      <button
        class="lbtn"
        class:active={l.id === 'hiking' ? hikeOn : activeBase === l.id}
        onclick={() => setLayer(l.id)}
      >
        <span class="ldot"></span>{l.label}
      </button>
    {/each}
  </div>
</div>
