<script>
  import { st } from '../state.svelte.js'
</script>

<div id="toast" class:show={st.toastVisible}>{st.toastMsg}</div>
