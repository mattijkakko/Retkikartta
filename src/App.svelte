<script>
  import { st } from './lib/state.svelte.js'
  import MapView from './lib/components/MapView.svelte'
  import StatsPanel from './lib/components/StatsPanel.svelte'
</script>

<header>
  <div class="logo">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#111111"/>
      <line x1="7" y1="17" x2="17" y2="7" stroke="white" stroke-width="2" stroke-linecap="round"/>
      <polyline points="12,6 18,6 18,12" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="7" cy="17" r="2.2" fill="white"/>
    </svg>
    REITTIKARTTA
  </div>
  <button class="search-btn" onclick={() => st.searchOpen = !st.searchOpen} title="Hae osoite">
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5"/>
      <line x1="12.5" y1="12.5" x2="16.5" y2="16.5"/>
    </svg>
  </button>
</header>

<div class="content">
  <MapView />
  <StatsPanel />
</div>
