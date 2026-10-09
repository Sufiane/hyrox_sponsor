<script lang="ts">
  import { SECONDARY_BUTTON_CLASS } from './auth-classes.ts';
  import type { Session } from './session.svelte.ts';

  interface Props {
    session: Session;
    onloggedout?: () => void;
  }

  let { session, onloggedout }: Props = $props();

  let pending = $state(false);

  async function handleClick(): Promise<void> {
    pending = true;

    try {
      await session.logout();
      onloggedout?.();
    } finally {
      pending = false;
    }
  }
</script>

<button type="button" class={SECONDARY_BUTTON_CLASS} disabled={pending} onclick={handleClick}>
  Log out
</button>
