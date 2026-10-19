# HYR-38 Bid Increment Rules and Primitives Implementation Plan (HYR-9 slice A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure increment rule, `ceilPercentOfCents`, and `auctionId`/`bidderId` constructors that the place-bid usecase (HYR-39) and endpoint (HYR-40) build on.

**Architecture:** Pure functions only. No Prisma, no Nest providers, no module wiring.

**Tech Stack:** TypeScript, Vitest (globals enabled).

**Spec:** `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/luxembourg/docs/specs/2026-10-14-hyr-38-bid-increment-rules-design.md`
**Umbrella:** `docs/plans/2026-10-14-bid-placement-plan.md` (this is its Slice A, Tasks 1-3).

Size: about 170 lines. Backend-only. Depends on nothing. Blocks HYR-39. Branch `hyr-38` (zero-padded two digits; rename before pushing, never after the PR exists).

## Global Constraints

- Explicit return types on every function; no single-letter variables (except `i/j/k` in indexed loops); no inline `if` (always braces); blank line before `if/for/while/return/throw` unless first in block; no `!!`; no commented-out code; no barrel files; numeric separators on literals of 5+ digits (`10_000`, `100_000_000`).
- Comments: none unless a non-obvious why.
- Branded types: `Cents`, `AuctionId`, `BidderId`. `src/common` never imports `@prisma/client`.
- Pure helpers throw only a snake_case code (`InvalidValueError`) and never log.
- Vitest: nested `describe` per condition titled `when ...`/`if ...`; `it` titles state only the outcome.
- No dependency changes.
- Conventional Commits (lowercase imperative); end commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage for `/crit`; do not commit until the user approves.
- Run from `/Users/sufianesouissi/conductor/workspaces/hyrox_sponsor/luxembourg`. Full check: `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json && npm run lint:arch`.

---

### Task 1: `ceilPercentOfCents`

**Files:**
- Modify: `src/common/money.ts`
- Modify: `src/common/money.spec.ts`

**Interfaces:**
- Produces: `ceilPercentOfCents(amount: Cents, percent: number): Cents` (throws `InvalidValueError('percent_invalid')` for negative or non-finite percent). `percentOfCents` (floors) is unchanged.

- [ ] **Step 1: Write the failing tests.** In `money.spec.ts` add `ceilPercentOfCents` to the import from `./money` (`InvalidValueError` is already imported) and append:

```ts
describe('ceilPercentOfCents', () => {
  describe('when the percentage is exact', () => {
    it('returns it unchanged', () => {
      expect(ceilPercentOfCents(cents(10_100), 5)).toBe(505);
    });
  });

  describe('when the percentage has a fractional cent', () => {
    it('rounds up', () => {
      expect(ceilPercentOfCents(cents(10_010), 5)).toBe(501);
    });
  });

  describe('when the amount is zero', () => {
    it('returns zero', () => {
      expect(ceilPercentOfCents(cents(0), 5)).toBe(0);
    });
  });

  describe('when the percent is negative', () => {
    it('throws percent_invalid', () => {
      expect(() => ceilPercentOfCents(cents(100), -1)).toThrow(new InvalidValueError('percent_invalid'));
    });
  });

  describe('when the percent is not finite', () => {
    it('throws percent_invalid', () => {
      expect(() => ceilPercentOfCents(cents(100), Number.NaN)).toThrow(new InvalidValueError('percent_invalid'));
    });
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/common/money.spec.ts` -> FAIL, `ceilPercentOfCents` is not exported.

- [ ] **Step 3: Implement.** Append to `src/common/money.ts`:

```ts
export function ceilPercentOfCents(amount: Cents, percent: number): Cents {
  if (!Number.isFinite(percent) || percent < 0) {
    throw new InvalidValueError('percent_invalid');
  }

  return cents(Math.ceil((amount * percent) / 100));
}
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/common/money.spec.ts` -> PASS.

- [ ] **Step 5: Stage.** `git add src/common/money.ts src/common/money.spec.ts`

---

### Task 2: `auctionId` and `bidderId` constructors

**Files:**
- Modify: `src/common/ids.ts`
- Modify: `src/common/ids.spec.ts`

**Interfaces:**
- Produces: `auctionId(value: string): AuctionId` (throws `InvalidValueError('auction_id_invalid')`), `bidderId(value: string): BidderId` (throws `InvalidValueError('bidder_id_invalid')`). Trim, reject empty, reject over 64 characters, via the existing private `validatedId`.

- [ ] **Step 1: Write the failing tests.** Add `auctionId, bidderId` to the import from `./ids` and append (mirror the existing `raceEntryId` tests in that file):

```ts
describe('auctionId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(auctionId(' auction_1 ')).toBe('auction_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws auction_id_invalid', () => {
      expect(() => auctionId('  ')).toThrow(new InvalidValueError('auction_id_invalid'));
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws auction_id_invalid', () => {
      expect(() => auctionId('x'.repeat(65))).toThrow(new InvalidValueError('auction_id_invalid'));
    });
  });
});

describe('bidderId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(bidderId(' bidder_1 ')).toBe('bidder_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws bidder_id_invalid', () => {
      expect(() => bidderId('')).toThrow(new InvalidValueError('bidder_id_invalid'));
    });
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/common/ids.spec.ts` -> FAIL (not exported).

- [ ] **Step 3: Implement.** Append to `src/common/ids.ts`:

```ts
export function auctionId(value: string): AuctionId {
  return validatedId(value, 'auction_id_invalid') as AuctionId;
}

export function bidderId(value: string): BidderId {
  return validatedId(value, 'bidder_id_invalid') as BidderId;
}
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/common/ids.spec.ts` -> PASS.

- [ ] **Step 5: Stage.** `git add src/common/ids.ts src/common/ids.spec.ts`

---

### Task 3: Increment rules

**Files:**
- Create: `src/bids/bid-increment.ts`
- Create: `src/bids/bid-increment.spec.ts`

**Interfaces:**
- Consumes: `addCents`, `ceilPercentOfCents`, `cents`, `Cents` from `../common/money` (Task 1).
- Produces: `INCREMENT_FLAT_CENTS: Cents` (500), `INCREMENT_THRESHOLD_CENTS: Cents` (10_000), `INCREMENT_PERCENT = 5`, `MAX_BID_CENTS: Cents` (100_000_000), `minimumIncrementCents(leader: Cents): Cents`, `minimumNextBidCents(leader: Cents | null, floor: Cents): Cents`.

- [ ] **Step 1: Write the failing test** (`src/bids/bid-increment.spec.ts`):

```ts
import { cents } from '../common/money';
import { minimumIncrementCents, minimumNextBidCents } from './bid-increment';

describe('minimumIncrementCents', () => {
  describe('when the leader is under $100', () => {
    it.each([
      [0, 500],
      [1_000, 500],
      [9_999, 500],
    ])('leader %i cents -> increment %i', (leader, expected) => {
      expect(minimumIncrementCents(cents(leader))).toBe(expected);
    });
  });

  describe('when the leader is exactly $100', () => {
    it('is the same as the flat increment', () => {
      expect(minimumIncrementCents(cents(10_000))).toBe(500);
    });
  });

  describe('when the leader is above $100', () => {
    it.each([
      [10_010, 501],
      [10_100, 505],
      [100_000, 5_000],
      [99_999_999, 5_000_000],
    ])('leader %i cents -> increment %i (5%% rounded up)', (leader, expected) => {
      expect(minimumIncrementCents(cents(leader))).toBe(expected);
    });
  });
});

describe('minimumNextBidCents', () => {
  const floor = cents(2_500);

  describe('when there is no leader', () => {
    it('is the floor', () => {
      expect(minimumNextBidCents(null, floor)).toBe(2_500);
    });
  });

  describe('when the leader is under $100', () => {
    it('adds the flat increment', () => {
      expect(minimumNextBidCents(cents(3_000), floor)).toBe(3_500);
    });
  });

  describe('when the leader is above $100', () => {
    it('adds 5% rounded up', () => {
      expect(minimumNextBidCents(cents(10_100), floor)).toBe(10_605);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/bids/bid-increment.spec.ts` -> FAIL (module missing).

- [ ] **Step 3: Implement** `src/bids/bid-increment.ts`:

```ts
import { addCents, ceilPercentOfCents, cents, type Cents } from '../common/money';

export const INCREMENT_FLAT_CENTS = cents(500);
export const INCREMENT_THRESHOLD_CENTS = cents(10_000);
export const INCREMENT_PERCENT = 5;
export const MAX_BID_CENTS = cents(100_000_000);

export function minimumIncrementCents(leader: Cents): Cents {
  if (leader < INCREMENT_THRESHOLD_CENTS) {
    return INCREMENT_FLAT_CENTS;
  }

  return ceilPercentOfCents(leader, INCREMENT_PERCENT);
}

export function minimumNextBidCents(leader: Cents | null, floor: Cents): Cents {
  if (leader === null) {
    return floor;
  }

  return addCents(leader, minimumIncrementCents(leader));
}
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/bids/bid-increment.spec.ts` -> PASS; then `npx vitest run src/common` -> PASS.

- [ ] **Step 5: Stage.** `git add src/bids/bid-increment.ts src/bids/bid-increment.spec.ts`

---

### Slice gate

- [ ] Run the full check: `npm test && npm run lint && npx tsc --noEmit -p tsconfig.json && npm run lint:arch`. All green. Nothing in the app imports the new code yet, so no runtime behavior changes.
- [ ] Stage everything and tell the user it is ready for `/crit`. PR title: `feat(bids): add bid increment rules`. Move HYR-38 to In Progress when starting, In Review once staged.
