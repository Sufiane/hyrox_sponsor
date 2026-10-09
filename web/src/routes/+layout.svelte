<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { session } from '../lib/auth/session.svelte.ts';

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    void session.bootstrap();
  });
</script>

{@render children()}
