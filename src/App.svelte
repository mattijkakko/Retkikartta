<script>
  import { st } from './lib/state.svelte.js'
  import MapView from './lib/components/MapView.svelte'
  import StatsPanel from './lib/components/StatsPanel.svelte'
</script>

<header>
  <div class="logo">🌲 Retki <em>kartta</em></div>
  <button class="search-btn" onclick={() => st.searchOpen = !st.searchOpen} title="Hae osoite">🔍</button>
</header>

<div class="content">
  <MapView />
  <StatsPanel />
</div>
