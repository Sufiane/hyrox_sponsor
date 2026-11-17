# HYR-61 Guest Card Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Svelte component that captures a guest's email and card through Stripe Elements against `POST /bidders/setup-intents`, mounted on a `/dev/card` harness route.

**Architecture:** Browser calls the API directly. `bidder-api.ts` wraps the endpoint, `bidder-token-store.ts` keeps the returned token (memory + sessionStorage, expiry aware), `stripe-loader.ts` hides Stripe.js behind a small injectable interface, and `GuestCardCapture.svelte` is a state machine over those three. No auction page, no bid gate.

**Tech Stack:** SvelteKit 3, Svelte 5 runes, Tailwind 4, Vitest 5 + Testing Library, `@stripe/stripe-js` (exact pin).

**Spec:** `docs/specs/2026-11-17-hyr-61-guest-card-capture-design.md`

## Global Constraints

- All work under `web/`. Run commands from `web/` (`npx vitest run <path>`).
- Dependencies pinned exactly: no `^`/`~`.
- Token goes only in the `X-Bidder-Token` header, never `Authorization`.
- Explicit return types on every function; no single-letter names (except `i/j/k` counters); braces on every `if`; blank line before `if`/`for`/`return`/`throw` unless first in block; numeric separators for literals of 5+ digits; no comments unless the why is non-obvious.
- Tests: nested `describe` per condition (`when ...`), short `it` titles, shared setup in that `describe`'s `beforeEach`. Files use `.ts` import extensions like the rest of `web/src/lib`.
- Conventional commits, lowercase imperative.

---

### Task 1: API client, error messages, token store

**Files:**
- Create: `web/src/lib/bidder/bidder-api.ts`, `bidder-api.spec.ts`
- Create: `web/src/lib/bidder/bidder-errors.ts`, `bidder-errors.spec.ts`
- Create: `web/src/lib/bidder/bidder-token-store.ts`, `bidder-token-store.spec.ts`

**Interfaces:**
- Produces:
  - `interface SetupIntentResponse { clientSecret: string; bidderToken: string; bidderTokenExpiresAt: string }`
  - `interface BidderApi { createSetupIntent(email: string, token: string | null): Promise<ApiResult<SetupIntentResponse>> }`
  - `createBidderApi(baseUrl: string, fetchImpl: typeof fetch): BidderApi`
  - `bidderErrorMessage(code: string, status?: number): string`
  - `interface BidderTokenStore { get(): string | null; set(token: string, expiresAt: string): void; clear(): void }`
  - `createBidderTokenStore(storage: TokenStorage | null, now: () => number): BidderTokenStore` where `type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>`

- [ ] **Step 1: Write failing tests**

`bidder-api.spec.ts`:

```ts
import type { Mock } from 'vitest';
import { createBidderApi } from './bidder-api.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createBidderApi', () => {
  let fetchImpl: Mock<typeof fetch>;

  beforeEach(() => {
    fetchImpl = vi.fn<typeof fetch>();
  });

  describe('createSetupIntent', () => {
    describe('when no token is stored', () => {
      beforeEach(() => {
        fetchImpl.mockResolvedValue(
          jsonResponse({ clientSecret: 'seti_secret', bidderToken: 'a.b.c', bidderTokenExpiresAt: '2026-11-18T00:00:00.000Z' }, 201),
        );
      });

      it('posts the email without a token header', async () => {
        await createBidderApi('http://api.test', fetchImpl).createSetupIntent('guest@example.com', null);

        expect(fetchImpl).toHaveBeenCalledWith('http://api.test/bidders/setup-intents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'guest@example.com' }),
        });
      });

      it('returns the response body', async () => {
        await expect(
          createBidderApi('http://api.test', fetchImpl).createSetupIntent('guest@example.com', null),
        ).resolves.toEqual({
          ok: true,
          value: { clientSecret: 'seti_secret', bidderToken: 'a.b.c', bidderTokenExpiresAt: '2026-11-18T00:00:00.000Z' },
        });
      });
    });

    describe('when a token is stored', () => {
      it('sends it in X-Bidder-Token', async () => {
        fetchImpl.mockResolvedValue(jsonResponse({}, 201));

        await createBidderApi('http://api.test', fetchImpl).createSetupIntent('guest@example.com', 'a.b.c');

        expect(fetchImpl).toHaveBeenCalledWith(
          'http://api.test/bidders/setup-intents',
          expect.objectContaining({ headers: { 'content-type': 'application/json', 'x-bidder-token': 'a.b.c' } }),
        );
      });
    });

    describe('when the API rejects the token', () => {
      it('returns the error code and status', async () => {
        fetchImpl.mockResolvedValue(jsonResponse({ message: 'bidder_token_required' }, 401));

        await expect(
          createBidderApi('http://api.test', fetchImpl).createSetupIntent('guest@example.com', null),
        ).resolves.toEqual({ ok: false, status: 401, code: 'bidder_token_required' });
      });
    });
  });
});
```

Before writing the assertion on the 401 body, open `web/src/lib/auth/error-code.ts` and match its expected body shape; adjust the `jsonResponse` body in that test to the shape `errorCode` reads.

`bidder-errors.spec.ts`:

```ts
import { bidderErrorMessage } from './bidder-errors.ts';

describe('bidderErrorMessage', () => {
  describe.each([
    ['email_invalid', 'Enter a valid email address.'],
    ['bidder_token_required', 'This email already has a saved card on another device. Use that device to continue.'],
    ['bidder_stripe_customer_conflict', 'Your payment profile is being set up. Wait a moment and try again.'],
    ['request_failed', 'We could not reach the server. Check your connection and try again.'],
  ])('when the code is %s', (code, expected) => {
    it('returns its message', () => {
      expect(bidderErrorMessage(code)).toBe(expected);
    });
  });

  describe('when the status is 429', () => {
    it('returns the throttle message', () => {
      expect(bidderErrorMessage('throttler_exception', 429)).toBe('Too many attempts. Wait a minute and try again.');
    });
  });

  describe('when the code is unknown', () => {
    it('returns the generic message', () => {
      expect(bidderErrorMessage('boom')).toBe('Something went wrong. Try again.');
    });
  });
});
```

`bidder-token-store.spec.ts`:

```ts
import { createBidderTokenStore } from './bidder-token-store.ts';
import type { TokenStorage } from './bidder-token-store.ts';

function fakeStorage(): TokenStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();

  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('createBidderTokenStore', () => {
  const NOW = Date.parse('2026-11-17T12:00:00.000Z');

  describe('when a token has not expired', () => {
    it('returns it', () => {
      const store = createBidderTokenStore(fakeStorage(), () => NOW);

      store.set('a.b.c', '2026-11-18T12:00:00.000Z');

      expect(store.get()).toBe('a.b.c');
    });

    it('is readable by a new store over the same storage', () => {
      const storage = fakeStorage();

      createBidderTokenStore(storage, () => NOW).set('a.b.c', '2026-11-18T12:00:00.000Z');

      expect(createBidderTokenStore(storage, () => NOW).get()).toBe('a.b.c');
    });
  });

  describe('when a token has expired', () => {
    it('returns null and clears storage', () => {
      const storage = fakeStorage();
      const store = createBidderTokenStore(storage, () => NOW);

      store.set('a.b.c', '2026-11-17T11:59:59.000Z');

      expect(store.get()).toBeNull();
      expect(storage.data.size).toBe(0);
    });
  });

  describe('when the expiry is not a date', () => {
    it('does not keep the token', () => {
      const store = createBidderTokenStore(fakeStorage(), () => NOW);

      store.set('a.b.c', 'nonsense');

      expect(store.get()).toBeNull();
    });
  });

  describe('when storage throws', () => {
    it('falls back to memory', () => {
      const throwing: TokenStorage = {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      };
      const store = createBidderTokenStore(throwing, () => NOW);

      store.set('a.b.c', '2026-11-18T12:00:00.000Z');

      expect(store.get()).toBe('a.b.c');
    });
  });

  describe('when there is no storage', () => {
    it('keeps the token in memory', () => {
      const store = createBidderTokenStore(null, () => NOW);

      store.set('a.b.c', '2026-11-18T12:00:00.000Z');

      expect(store.get()).toBe('a.b.c');
    });
  });

  describe('clear', () => {
    it('removes the token', () => {
      const store = createBidderTokenStore(fakeStorage(), () => NOW);

      store.set('a.b.c', '2026-11-18T12:00:00.000Z');
      store.clear();

      expect(store.get()).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/bidder`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`bidder-api.ts`:

```ts
import { sendJson } from '../results/api-result.ts';
import type { ApiResult } from '../results/api-result.ts';

export interface SetupIntentResponse {
  clientSecret: string;
  bidderToken: string;
  bidderTokenExpiresAt: string;
}

export interface BidderApi {
  createSetupIntent(email: string, token: string | null): Promise<ApiResult<SetupIntentResponse>>;
}

export function createBidderApi(baseUrl: string, fetchImpl: typeof fetch): BidderApi {
  return {
    createSetupIntent(email: string, token: string | null): Promise<ApiResult<SetupIntentResponse>> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };

      if (token != null) {
        headers['x-bidder-token'] = token;
      }

      return sendJson(fetchImpl, `${baseUrl}/bidders/setup-intents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email }),
      });
    },
  };
}
```

`bidder-errors.ts`:

```ts
const MESSAGES: Record<string, string> = {
  email_invalid: 'Enter a valid email address.',
  validation_failed: 'Enter a valid email address.',
  bidder_token_required: 'This email already has a saved card on another device. Use that device to continue.',
  bidder_stripe_customer_conflict: 'Your payment profile is being set up. Wait a moment and try again.',
  stripe_unavailable: 'Our payment provider is unavailable right now. Try again shortly.',
  request_failed: 'We could not reach the server. Check your connection and try again.',
};

export function bidderErrorMessage(code: string, status?: number): string {
  if (status === 429) {
    return 'Too many attempts. Wait a minute and try again.';
  }

  return MESSAGES[code] ?? 'Something went wrong. Try again.';
}
```

`bidder-token-store.ts`:

```ts
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface BidderTokenStore {
  get(): string | null;
  set(token: string, expiresAt: string): void;
  clear(): void;
}

interface StoredToken {
  token: string;
  expiresAtMs: number;
}

const STORAGE_KEY = 'bidder-token';

function parseStored(raw: string | null): StoredToken | null {
  if (raw == null) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredToken>;

    if (typeof parsed.token === 'string' && typeof parsed.expiresAtMs === 'number') {
      return { token: parsed.token, expiresAtMs: parsed.expiresAtMs };
    }
  } catch {
    return null;
  }

  return null;
}

export function createBidderTokenStore(storage: TokenStorage | null, now: () => number): BidderTokenStore {
  let memory: StoredToken | null = null;

  function readStorage(): StoredToken | null {
    try {
      return parseStored(storage?.getItem(STORAGE_KEY) ?? null);
    } catch {
      return null;
    }
  }

  function wipeStorage(): void {
    try {
      storage?.removeItem(STORAGE_KEY);
    } catch {
      return;
    }
  }

  function clear(): void {
    memory = null;
    wipeStorage();
  }

  return {
    get(): string | null {
      const current = memory ?? readStorage();

      if (current == null) {
        return null;
      }

      if (current.expiresAtMs <= now()) {
        clear();

        return null;
      }

      memory = current;

      return current.token;
    },

    set(token: string, expiresAt: string): void {
      const expiresAtMs = Date.parse(expiresAt);

      if (Number.isNaN(expiresAtMs)) {
        clear();

        return;
      }

      memory = { token, expiresAtMs };

      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(memory));
      } catch {
        return;
      }
    },

    clear,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/bidder`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/bidder
git commit -m "feat(web): add bidder setup api client, error messages and token store"
```

---

### Task 2: Stripe loader

**Files:**
- Modify: `web/package.json` (via install), `package-lock.json`
- Create: `web/src/lib/bidder/stripe-loader.ts`, `stripe-loader.spec.ts`

**Interfaces:**
- Produces:
  - `interface CardElementLike { mount(target: HTMLElement): void; destroy(): void }`
  - `type CardSaveResult = { ok: true; brand: string; last4: string } | { ok: false; message: string }`
  - `interface StripeClient { createCardElement(): CardElementLike; saveCard(card: CardElementLike, clientSecret: string): Promise<CardSaveResult> }`
  - `type StripeLoader = () => Promise<StripeClient | null>` (null = no publishable key; rejects if Stripe.js fails to load)
  - `createStripeLoader(publishableKey: string | undefined): StripeLoader`

- [ ] **Step 1: Install and pin**

Run from repo root: `npm install -w web --save-exact @stripe/stripe-js`
Then confirm `web/package.json` has an exact version (no caret) under `dependencies`, and `git diff package-lock.json` only adds that package.

- [ ] **Step 2: Write failing test**

`stripe-loader.spec.ts`:

```ts
import { loadStripe } from '@stripe/stripe-js';
import { createStripeLoader } from './stripe-loader.ts';
import type { CardElementLike } from './stripe-loader.ts';

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));

describe('createStripeLoader', () => {
  const cardElement = { mount: vi.fn(), destroy: vi.fn() };
  const elements = { create: vi.fn(() => cardElement) };
  const stripe = {
    elements: vi.fn(() => elements),
    createPaymentMethod: vi.fn(),
    confirmCardSetup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadStripe).mockResolvedValue(stripe as never);
    stripe.elements.mockReturnValue(elements);
    elements.create.mockReturnValue(cardElement);
  });

  describe('when there is no publishable key', () => {
    it('resolves null without loading Stripe', async () => {
      await expect(createStripeLoader(undefined)()).resolves.toBeNull();
      expect(loadStripe).not.toHaveBeenCalled();
    });
  });

  describe('when Stripe.js fails to load', () => {
    it('rejects', async () => {
      vi.mocked(loadStripe).mockResolvedValue(null);

      await expect(createStripeLoader('pk_test_1')()).rejects.toThrow('stripe_load_failed');
    });
  });

  describe('when Stripe.js loads', () => {
    it('loads once for repeated calls', async () => {
      const loader = createStripeLoader('pk_test_1');

      await loader();
      await loader();

      expect(loadStripe).toHaveBeenCalledTimes(1);
      expect(loadStripe).toHaveBeenCalledWith('pk_test_1');
    });

    it('creates a card element', async () => {
      const client = await createStripeLoader('pk_test_1')();

      expect(client?.createCardElement()).toBe(cardElement);
      expect(elements.create).toHaveBeenCalledWith('card');
    });
  });

  describe('saveCard', () => {
    let card: CardElementLike;

    beforeEach(() => {
      card = cardElement;
    });

    describe('when the card is accepted', () => {
      it('creates the payment method then confirms the setup', async () => {
        stripe.createPaymentMethod.mockResolvedValue({
          paymentMethod: { id: 'pm_1', card: { brand: 'visa', last4: '4242' } },
        });
        stripe.confirmCardSetup.mockResolvedValue({ setupIntent: { id: 'seti_1' } });
        const client = await createStripeLoader('pk_test_1')();

        const result = await client?.saveCard(card, 'seti_secret');

        expect(stripe.createPaymentMethod).toHaveBeenCalledWith({ type: 'card', card: cardElement });
        expect(stripe.confirmCardSetup).toHaveBeenCalledWith('seti_secret', { payment_method: 'pm_1' });
        expect(result).toEqual({ ok: true, brand: 'visa', last4: '4242' });
      });
    });

    describe('when creating the payment method fails', () => {
      it('returns the Stripe message', async () => {
        stripe.createPaymentMethod.mockResolvedValue({ error: { message: 'Your card number is incomplete.' } });
        const client = await createStripeLoader('pk_test_1')();

        await expect(client?.saveCard(card, 'seti_secret')).resolves.toEqual({
          ok: false,
          message: 'Your card number is incomplete.',
        });
        expect(stripe.confirmCardSetup).not.toHaveBeenCalled();
      });
    });

    describe('when the confirmation is declined', () => {
      it('returns the Stripe message', async () => {
        stripe.createPaymentMethod.mockResolvedValue({
          paymentMethod: { id: 'pm_1', card: { brand: 'visa', last4: '0002' } },
        });
        stripe.confirmCardSetup.mockResolvedValue({ error: { message: 'Your card was declined.' } });
        const client = await createStripeLoader('pk_test_1')();

        await expect(client?.saveCard(card, 'seti_secret')).resolves.toEqual({
          ok: false,
          message: 'Your card was declined.',
        });
      });
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/bidder/stripe-loader.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`stripe-loader.ts`:

```ts
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe, StripeCardElement } from '@stripe/stripe-js';

export interface CardElementLike {
  mount(target: HTMLElement): void;
  destroy(): void;
}

export type CardSaveResult = { ok: true; brand: string; last4: string } | { ok: false; message: string };

export interface StripeClient {
  createCardElement(): CardElementLike;
  saveCard(card: CardElementLike, clientSecret: string): Promise<CardSaveResult>;
}

export type StripeLoader = () => Promise<StripeClient | null>;

const FALLBACK_MESSAGE = 'We could not save this card. Check the details and try again.';

function wrap(stripe: Stripe): StripeClient {
  return {
    createCardElement(): CardElementLike {
      return stripe.elements().create('card');
    },

    async saveCard(card: CardElementLike, clientSecret: string): Promise<CardSaveResult> {
      const created = await stripe.createPaymentMethod({ type: 'card', card: card as StripeCardElement });

      if (created.error != null || created.paymentMethod.card == null) {
        return { ok: false, message: created.error?.message ?? FALLBACK_MESSAGE };
      }

      const confirmed = await stripe.confirmCardSetup(clientSecret, { payment_method: created.paymentMethod.id });

      if (confirmed.error != null) {
        return { ok: false, message: confirmed.error.message ?? FALLBACK_MESSAGE };
      }

      return { ok: true, brand: created.paymentMethod.card.brand, last4: created.paymentMethod.card.last4 };
    },
  };
}

export function createStripeLoader(publishableKey: string | undefined): StripeLoader {
  let pending: Promise<StripeClient> | null = null;

  return async (): Promise<StripeClient | null> => {
    if (publishableKey == null || publishableKey === '') {
      return null;
    }

    pending ??= loadStripe(publishableKey).then((stripe) => {
      if (stripe == null) {
        throw new Error('stripe_load_failed');
      }

      return wrap(stripe);
    });

    return pending;
  };
}
```

If a rejected load is cached, retry can never recover: reset `pending = null` in a `.catch` that rethrows. Add a test for it ("when a previous load failed, loads again") and implement.

- [ ] **Step 5: Run to verify pass, then commit**

Run: `npx vitest run src/lib/bidder/stripe-loader.spec.ts` (PASS), `npm run check` from `web/` (no type errors).

```bash
git add package-lock.json web/package.json web/src/lib/bidder/stripe-loader.ts web/src/lib/bidder/stripe-loader.spec.ts
git commit -m "feat(web): add stripe.js loader wrapper"
```

---

### Task 3: GuestCardCapture component

**Files:**
- Create: `web/src/lib/bidder/GuestCardCapture.svelte`, `GuestCardCapture.spec.ts`

**Interfaces:**
- Consumes: `BidderApi`, `BidderTokenStore`, `StripeLoader`/`StripeClient`/`CardElementLike`, `bidderErrorMessage` from Task 1 and 2.
- Produces: component with props `{ api: BidderApi; stripeLoader: StripeLoader; tokenStore: BidderTokenStore }`.
- UI contract (used by tests): email input labelled `Email`; submit button `Continue`; card mount container `data-testid="card-element"`; save button `Save card`; saved text `Card saved: {brand} ending {last4}`; `role="alert"` for error/declined/token_required/unconfigured messages; retry button `Try again` in `error` and `declined` only.

- [ ] **Step 1: Write failing tests**

`GuestCardCapture.spec.ts`:

```ts
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import type { BidderApi } from './bidder-api.ts';
import type { BidderTokenStore } from './bidder-token-store.ts';
import GuestCardCapture from './GuestCardCapture.svelte';
import type { CardElementLike, StripeClient, StripeLoader } from './stripe-loader.ts';

const SETUP = { clientSecret: 'seti_secret', bidderToken: 'a.b.c', bidderTokenExpiresAt: '2026-11-18T00:00:00.000Z' };

describe('GuestCardCapture', () => {
  let createSetupIntent: Mock<BidderApi['createSetupIntent']>;
  let tokenStore: BidderTokenStore;
  let card: CardElementLike;
  let saveCard: Mock<StripeClient['saveCard']>;
  let stripeLoader: Mock<StripeLoader>;

  async function submitEmail(): Promise<void> {
    await userEvent.type(screen.getByLabelText('Email'), 'guest@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  function renderComponent(): void {
    render(GuestCardCapture, { api: { createSetupIntent }, stripeLoader, tokenStore });
  }

  beforeEach(() => {
    createSetupIntent = vi.fn<BidderApi['createSetupIntent']>().mockResolvedValue({ ok: true, value: SETUP });
    tokenStore = { get: vi.fn(() => null), set: vi.fn(), clear: vi.fn() };
    card = { mount: vi.fn(), destroy: vi.fn() };
    saveCard = vi.fn<StripeClient['saveCard']>().mockResolvedValue({ ok: true, brand: 'visa', last4: '4242' });
    stripeLoader = vi.fn<StripeLoader>().mockResolvedValue({ createCardElement: () => card, saveCard });
  });

  describe('when the guest submits an email', () => {
    it('calls the setup endpoint with the email and stored token', async () => {
      vi.mocked(tokenStore.get).mockReturnValue('old.tok.en');
      renderComponent();

      await submitEmail();

      await waitFor(() => expect(createSetupIntent).toHaveBeenCalledWith('guest@example.com', 'old.tok.en'));
    });

    it('stores the returned token', async () => {
      renderComponent();

      await submitEmail();

      await waitFor(() => expect(tokenStore.set).toHaveBeenCalledWith('a.b.c', '2026-11-18T00:00:00.000Z'));
    });

    it('mounts the card element and offers to save', async () => {
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('button', { name: 'Save card' })).toBeInTheDocument();
      expect(card.mount).toHaveBeenCalledWith(screen.getByTestId('card-element'));
    });
  });

  describe('when the card is saved', () => {
    it('shows the brand and last four digits', async () => {
      renderComponent();
      await submitEmail();

      await userEvent.click(await screen.findByRole('button', { name: 'Save card' }));

      expect(await screen.findByText('Card saved: visa ending 4242')).toBeInTheDocument();
      expect(saveCard).toHaveBeenCalledWith(card, 'seti_secret');
    });
  });

  describe('when the card is declined', () => {
    beforeEach(() => {
      saveCard.mockResolvedValue({ ok: false, message: 'Your card was declined.' });
    });

    it('shows the message and offers a retry', async () => {
      renderComponent();
      await submitEmail();

      await userEvent.click(await screen.findByRole('button', { name: 'Save card' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('retry requests a fresh setup intent', async () => {
      renderComponent();
      await submitEmail();
      await userEvent.click(await screen.findByRole('button', { name: 'Save card' }));

      await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

      await waitFor(() => expect(createSetupIntent).toHaveBeenCalledTimes(2));
      expect(card.destroy).toHaveBeenCalled();
    });
  });

  describe('when the API fails', () => {
    beforeEach(() => {
      createSetupIntent.mockResolvedValue({ ok: false, status: 400, code: 'email_invalid' });
    });

    it('shows the mapped message and offers a retry', async () => {
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  describe('when the API throttles', () => {
    it('shows the throttle message', async () => {
      createSetupIntent.mockResolvedValue({ ok: false, status: 429, code: 'throttler_exception' });
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Wait a minute and try again.');
    });
  });

  describe('when the email is already registered on another device', () => {
    beforeEach(() => {
      createSetupIntent.mockResolvedValue({ ok: false, status: 401, code: 'bidder_token_required' });
    });

    it('shows a terminal message with no retry', async () => {
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('already has a saved card on another device');
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save card' })).not.toBeInTheDocument();
    });
  });

  describe('when no publishable key is configured', () => {
    beforeEach(() => {
      stripeLoader.mockResolvedValue(null);
    });

    it('shows a configuration message and never calls the API', async () => {
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('Card payments are not configured.');
      expect(createSetupIntent).not.toHaveBeenCalled();
    });
  });

  describe('when Stripe.js fails to load', () => {
    it('shows a retryable error', async () => {
      stripeLoader.mockRejectedValue(new Error('stripe_load_failed'));
      renderComponent();

      await submitEmail();

      expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/bidder/GuestCardCapture.spec.ts`
Expected: FAIL, component not found.

- [ ] **Step 3: Implement**

`GuestCardCapture.svelte`:

```svelte
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { BidderApi } from './bidder-api.ts';
  import { bidderErrorMessage } from './bidder-errors.ts';
  import type { BidderTokenStore } from './bidder-token-store.ts';
  import type { CardElementLike, StripeClient, StripeLoader } from './stripe-loader.ts';

  type Phase =
    | 'idle'
    | 'loading'
    | 'ready'
    | 'confirming'
    | 'saved'
    | 'declined'
    | 'error'
    | 'token_required'
    | 'unconfigured';

  interface Props {
    api: BidderApi;
    stripeLoader: StripeLoader;
    tokenStore: BidderTokenStore;
  }

  let { api, stripeLoader, tokenStore }: Props = $props();

  let phase = $state<Phase>('idle');
  let email = $state('');
  let message = $state<string | null>(null);
  let savedCard = $state<{ brand: string; last4: string } | null>(null);
  let container = $state<HTMLDivElement>();

  let stripe: StripeClient | null = null;
  let card: CardElementLike | null = null;
  let clientSecret = '';

  const showForm = $derived(phase === 'idle' || phase === 'error' || phase === 'declined' || phase === 'loading');
  const cardVisible = $derived(phase === 'ready' || phase === 'confirming');

  function teardownCard(): void {
    card?.destroy();
    card = null;
  }

  function fail(next: Phase, text: string): void {
    message = text;
    phase = next;
  }

  async function start(): Promise<void> {
    phase = 'loading';
    message = null;
    teardownCard();

    try {
      stripe = await stripeLoader();
    } catch {
      fail('error', bidderErrorMessage('request_failed'));

      return;
    }

    if (stripe == null) {
      fail('unconfigured', 'Card payments are not configured.');

      return;
    }

    const result = await api.createSetupIntent(email.trim(), tokenStore.get());

    if (!result.ok) {
      if (result.code === 'bidder_token_required') {
        fail('token_required', bidderErrorMessage(result.code));

        return;
      }

      fail('error', bidderErrorMessage(result.code, result.status));

      return;
    }

    tokenStore.set(result.value.bidderToken, result.value.bidderTokenExpiresAt);
    clientSecret = result.value.clientSecret;
    phase = 'ready';
    await tick();

    card = stripe.createCardElement();

    if (container != null) {
      card.mount(container);
    }
  }

  async function save(): Promise<void> {
    if (stripe == null || card == null) {
      return;
    }

    phase = 'confirming';

    const outcome = await stripe.saveCard(card, clientSecret);

    if (outcome.ok) {
      savedCard = { brand: outcome.brand, last4: outcome.last4 };
      phase = 'saved';

      return;
    }

    fail('declined', outcome.message);
  }

  onDestroy(teardownCard);
</script>

<section class="flex flex-col gap-4">
  {#if showForm}
    <form
      class="flex flex-col gap-3"
      onsubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <label class="flex flex-col gap-1 text-sm">
        Email
        <input
          class="rounded border border-slate-300 px-3 py-2"
          type="email"
          autocomplete="email"
          required
          bind:value={email}
          disabled={phase === 'loading'}
        />
      </label>
      <button class="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50" type="submit" disabled={phase === 'loading'}>
        {phase === 'loading' ? 'Loading…' : 'Continue'}
      </button>
    </form>
  {/if}

  <div class:hidden={!cardVisible} class="flex flex-col gap-3">
    <div class="rounded border border-slate-300 p-3" data-testid="card-element" bind:this={container}></div>
    <button
      class="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
      type="button"
      onclick={() => void save()}
      disabled={phase === 'confirming'}
    >
      {phase === 'confirming' ? 'Saving…' : 'Save card'}
    </button>
  </div>

  {#if phase === 'saved' && savedCard != null}
    <p class="text-sm text-green-900">Card saved: {savedCard.brand} ending {savedCard.last4}</p>
  {/if}

  {#if message != null && (phase === 'error' || phase === 'declined' || phase === 'token_required' || phase === 'unconfigured')}
    <p class="text-sm text-red-800" role="alert">{message}</p>
  {/if}

  {#if phase === 'error' || phase === 'declined'}
    <button class="self-start underline" type="button" onclick={() => void start()}>Try again</button>
  {/if}
</section>
```

Note: the `Save card` button is in the DOM while hidden, so the "no Save card button" assertions in the `token_required` test use `queryByRole`, which ignores elements hidden via `display: none` only when the `hidden` class is backed by CSS. Tailwind is not loaded in jsdom, so those assertions would fail. Fix: render the save button with `{#if cardVisible}` and keep only the mount container always present (its parent `div` stays, button inside the `{#if}`). Apply that change while making the tests pass.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/bidder` then `npm run check`
Expected: PASS, no type errors. When `Try again` runs on `declined`, the email field is visible and retains its value (it is bound state).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/bidder/GuestCardCapture.svelte web/src/lib/bidder/GuestCardCapture.spec.ts
git commit -m "feat(web): add guest card capture component"
```

---

### Task 4: Harness route, env and docs

**Files:**
- Create: `web/src/routes/dev/card/+page.svelte`
- Modify: `web/.env.example`

**Interfaces:**
- Consumes: `createBidderApi`, `createBidderTokenStore`, `createStripeLoader`, `GuestCardCapture`.

- [ ] **Step 1: Add the route**

`web/src/routes/dev/card/+page.svelte`:

```svelte
<script lang="ts">
  import { createBidderApi } from '../../../lib/bidder/bidder-api.ts';
  import { createBidderTokenStore } from '../../../lib/bidder/bidder-token-store.ts';
  import GuestCardCapture from '../../../lib/bidder/GuestCardCapture.svelte';
  import { createStripeLoader } from '../../../lib/bidder/stripe-loader.ts';

  const api = createBidderApi(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000', (...args) => fetch(...args));
  const tokenStore = createBidderTokenStore(typeof sessionStorage === 'undefined' ? null : sessionStorage, () => Date.now());
  const stripeLoader = createStripeLoader(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
</script>

<svelte:head>
  <title>Card capture (dev)</title>
</svelte:head>

<main class="mx-auto flex max-w-md flex-col gap-6 p-6 text-slate-900">
  <header class="flex flex-col gap-1">
    <h1 class="text-lg font-semibold">Guest card capture</h1>
    <p class="text-sm text-slate-700">Dev harness. Does not gate bidding.</p>
  </header>

  <GuestCardCapture {api} {stripeLoader} {tokenStore} />
</main>
```

- [ ] **Step 2: Env docs**

Append to `web/.env.example`:

```
# Stripe publishable key (pk_test_...) for the guest card capture step.
VITE_STRIPE_PUBLISHABLE_KEY=
```

- [ ] **Step 3: Verify**

Run from repo root: `npm run verify`.
Expected: lint, typecheck and all tests green. If `verify` fails on a pre-existing issue unrelated to `web/src/lib/bidder` or the new route, report it rather than fixing it.

Manual check (needs the API running with Stripe test keys and `VITE_STRIPE_PUBLISHABLE_KEY` set): open `http://localhost:5173/dev/card`, enter an email, use card `4242 4242 4242 4242`, confirm "Card saved: visa ending 4242"; use `4000 0000 0000 0002` and confirm the declined message and retry. Say explicitly if this manual check was not run.

- [ ] **Step 4: Stage (do not commit)**

```bash
git add web/src/routes/dev/card web/.env.example
```

Stop here: user reviews with `/crit` before the final commit.
