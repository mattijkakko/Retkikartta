<script>
  let { results, routePts, searching, onQueryInput, onSelect, onAddToRoute, onRemoveRoute, onBuildRoute, onClose } = $props()

  let query = $state('')

  function handleInput() { onQueryInput(query) }
  function clear() { query = ''; onQueryInput('') }
</script>

<div id="searchPanel">
  <div class="search-input-row">
    <span class="search-icon">🔍</span>
    <input
      type="search"
      placeholder="Hae osoite tai koordinaatit…"
      bind:value={query}
      oninput={handleInput}
      autofocus
    >
    <button class="search-close" onclick={onClose}>✕</button>
  </div>

  {#if searching}
    <div class="search-status">Haetaan…</div>
  {:else if query.length >= 3 && results.length === 0}
    <div class="search-status">Ei tuloksia</div>
  {/if}

  {#if results.length}
    <div class="search-results">
      {#each results as r}
        <div class="search-result-row">
          <button class="search-result-name" onclick={() => { onSelect(r); clear() }}>
            <span class="sr-main">{r.name}</span>
            <span class="sr-sub">{r.fullName.split(',').slice(1, 3).join(',').trim()}</span>
          </button>
          <button class="search-add-btn" onclick={() => { onAddToRoute(r); clear() }} title="Lisää reittipisteeksi">+</button>
        </div>
      {/each}
    </div>
  {/if}

  {#if routePts.length}
    <div class="search-route-list">
      <div class="search-route-title">Reittipisteet</div>
      {#each routePts as p, i}
        <div class="search-route-pt">
          <span class="rpt-num">{i + 1}</span>
          <span class="rpt-name">{p.name}</span>
          <button class="rpt-remove" onclick={() => onRemoveRoute(i)}>✕</button>
        </div>
      {/each}
      {#if routePts.length >= 2}
        <button class="search-route-calc" onclick={onBuildRoute}>
          🧭 Laske reitti ({routePts.length} pistettä)
        </button>
      {:else}
        <div class="search-status">Lisää vähintään 2 pistettä</div>
      {/if}
    </div>
  {/if}
</div>
