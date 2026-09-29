# HYR-2: Core Data Model — Design Spec

Status: Approved (design), pending final spec sign-off
Ticket: Linear HYR-2 (team hyrox-sponsor, project "Hyrox Sponsor — MVP", milestone M0 — Foundations)
Date: 2026-09-28

## 1. Context

First ticket for a brand-new, empty repo. This ticket establishes both the backend
stack/tooling and the core data model for a US-only, web-only MVP where Hyrox
athletes auction ad space on 9 fixed body zones to brands/individuals. The platform
takes a commission and holds funds in escrow via Stripe Connect (manual capture,
delayed payout) until proof of sponsorship is verified at the race.

This ticket does not implement any business flows (auth, bidding logic, scheduling
jobs, verification review UI). It delivers: the stack choice, the Prisma schema,
migrations, and minimal per-module scaffolding (service/db pairs with basic reads)
so downstream tickets (HYR-3 athlete auth, HYR-4 guest bidder identity, HYR-5 race
logging, HYR-6 bib verification gate, HYR-8 auction scheduling job) have a stable
foundation to build on without schema rework.

## 2. Locked product context (from the Linear project, 2026-09-27 grill session)

- Escrow: Stripe Connect, manual capture + delayed payout. Per-bid-lifecycle auth
  hold; only the current leading bid holds an active authorization at any time.
- Market: US only, USD.
- Auction window: fixed, race day −12 to race day −5 (7-day window).
- Bid increments: $5 flat until $100, then 5% (enforced at service layer, not DB).
- Commission: 15% of winning bid, $5 flat minimum, deducted from the bid.
- Body zones (9, fixed): left/right pec, upper back, lower back, left/right arm,
  left/right thigh, ass. Athlete sets floor price per zone, $10 platform absolute
  minimum.
- Race verification: bib/confirmation upload required before an auction can open.
  No official results API for MVP; past results self-reported.
- Proof of sponsorship: photo/video within 48h post-race, staff manual
  approve/reject.
- Failure/dispute path: grace period + reminders → auto-refund if no proof;
  arbitration queue on dispute; non-refundable processing fee kept on failed
  auctions.
- Strikes/trust: 3 strikes = permanent ban; trust score (0-100) drives
  ranking/visibility.
- No exclusivity rules for MVP.
- Sponsorship history shown publicly is aggregate/lifetime total only.
- 18+ self-attestation only, no automated content filtering.
- Bidder onboarding is guest checkout (email + card via Stripe), no account.
- Athletes have signup/auth (HYR-3, not in scope here).

## 3. Stack decision

- **Framework:** NestJS v12 (TypeScript), Node 24 (latest LTS).
- **Module system:** Native ESM throughout — `package.json` has `"type": "module"`, `tsconfig.json` uses `module`/`moduleResolution`: `NodeNext`. Every relative import in source/test files carries an explicit `.js` extension per Node ESM resolution rules (package imports like `@nestjs/common`/`@prisma/client` are unaffected).
- **Test runner:** Vitest (pairs naturally with ESM; no CommonJS-oriented transform step like `ts-jest` needed).
- **ORM:** Prisma.
- **Database:** PostgreSQL.
- **Rationale:** CLAUDE.md's hexagonal `*.service.ts`/`*.db.ts` split is written in
  NestJS terms and maps directly onto Prisma (`*.db.ts` is the only file per
  module allowed to import `@prisma/client`). Postgres gives native enums, integer
  money types, partial/filtered indexes, and mature Prisma migration support —
  all needed here (escrow state machine, leading-bid uniqueness constraint).
- Single Nest app for now; no npm workspaces yet (no shared package to split out
  until a frontend project exists). All dependencies pinned to exact versions
  (resolved from `package-lock.json` into `package.json` after install), per
  CLAUDE.md.
- Money stored as integer cents (`Int`) everywhere — never floating point.
- **Architecture enforcement:** `dependency-cruiser` added as a dev dependency
  with a forbidden-dependency rule: `*.service.ts`/`*.usecase.ts` files must not
  import `@prisma/client`; only `*.db.ts` files may. Wired into an `npm run
  lint:arch` script (or folded into the existing lint script) so CI/local checks
  catch violations of the CLAUDE.md hexagonal split automatically.

## 4. Module scaffolding (HYR-2 scope only)

Per CLAUDE.md hexagonal convention. No controllers or business logic beyond
minimal reads needed to prove the schema compiles and queries work — downstream
tickets fill in the real flows.

- `PrismaModule` — global module wrapping a single `PrismaService`.
- `athletes/` — `AthleteDb`, `AthleteService` (basic read by id).
- `races/` — `RaceDb`, `RaceService`, plus `RaceEntryDb`/`RaceEntryService`.
- `zones/` — `ZoneFloorPriceDb`, `ZoneFloorPriceService`.
- `auctions/` — `AuctionDb`, `AuctionService`.
- `bids/` — `BidDb`, `BidService`.
- `escrow/` — `EscrowTransactionDb`, `EscrowTransactionService`.
- `proofs/` — `SponsorshipProofDb`, `SponsorshipProofService`.
- `disputes/` — `DisputeDb`, `DisputeService`.
- `trust/` — `StrikeDb`, `TrustScoreEventDb`, `TrustService` (single service
  covering both since they're both rollups onto `Athlete`).
- `bidders/` — `BidderDb`, `BidderService`.

Each feature module registers its `*Service` and `*Db` as providers per
CLAUDE.md's example shape. No cross-module business orchestration is built in
this ticket (that belongs to the usecases that HYR-3/4/5/6/8 will add).

## 5. Entities

### 5.1 Reference data

**BodyZone** — Prisma enum (not a table): `LEFT_PEC, RIGHT_PEC, UPPER_BACK,
LOWER_BACK, LEFT_ARM, RIGHT_ARM, LEFT_THIGH, RIGHT_THIGH, ASS`. Fixed set with no
admin CRUD needed for MVP.

### 5.2 Identity

**Athlete**
- `id`, profile fields (name, email placeholder for future auth, etc.)
- `isAdult` boolean + `adultAttestedAt` timestamp (18+ self-attestation)
- `trustScore` Int, default 50 (0-100 range enforced at service layer)
- `strikeCount` Int — derived rollup, recomputed from active `Strike` rows, not
  hand-set by callers
- `isBanned` Boolean — derived rollup, flips true when active strike count hits 3
- `lifetimeSponsorshipCents` Int, default 0 — aggregate total for public display,
  updated on auction completion
- `stripeConnectAccountId` String, nullable — the athlete's own Stripe Connect
  account id for payouts (null until onboarding; consumed by HYR-14)
- `createdAt`/`updatedAt`

Auth fields (password hash, etc.) are deliberately deferred to HYR-3 — this row
exists now purely as the FK target other entities need.

**Bidder**
- `id`, `email` (unique), `stripeCustomerId` (nullable until first successful
  Stripe interaction)
- `createdAt`/`updatedAt`
- Upserted on first bid placement (no password, no separate signup flow).

### 5.3 Zone pricing

**ZoneFloorPrice**
- `id`, `athleteId` FK, `zone` (BodyZone enum), `floorPriceCents` Int
- Unique constraint on `(athleteId, zone)`
- `floorPriceCents >= 1000` ($10 platform minimum) enforced at service layer; DB
  has a `CHECK (floor_price_cents >= 1000)` constraint as a backstop.
- One row per athlete per zone; athlete can update between races (existing
  `Auction`s snapshot the floor at open time, see 5.5, so edits don't retroact).

### 5.4 Races & entry

**Race**
- `id`, `name`, `date` (`timestamptz`, race's local start instant), `timezone`
  (IANA string, e.g. `America/Chicago`), `location`, `createdAt`/`updatedAt`.

**RaceEntry** — join of Athlete + Race
- `id`, `athleteId` FK, `raceId` FK, `bibNumber`, `verificationStatus`
  (`PENDING/VERIFIED/REJECTED`), `verificationDocumentUrl`, `verifiedAt`,
  `verifiedBy`
- `raceDate` (`timestamptz`) — denormalized copy of `Race.date` at creation time,
  immutable thereafter
- `raceLocalDate` (`date`) — the race's calendar date in `Race.timezone`,
  computed by the application at entry-creation time and immutable thereafter
  (no creation code exists in the data-model ticket).
- Unique index on `(athleteId, raceLocalDate)` — blocks an athlete from having
  two race entries on the same local calendar date regardless of bib/race id or
  start time (enforced at the DB level since Postgres can't uniquely constrain
  across a join without denormalization). Keyed on the local date, not the
  `raceDate` instant, so two same-day races with different start times are
  still rejected.
- Index on `raceId` (FK lookups).
- `Auction` rows for an athlete+race can only be created once
  `verificationStatus = VERIFIED` (service-layer gate; HYR-6 scope).

### 5.5 Auctions & bids

**Auction** — one per `(RaceEntry, BodyZone)`, unique constraint on
`(raceEntryId, zone)`.
- `id`, `raceEntryId` FK, `zone` (BodyZone enum)
- `floorPriceCents` Int — snapshot copied from `ZoneFloorPrice` at auction-open
  time; later floor-price edits never retroactively change an already-open
  auction.
- `openAt`, `closeAt` (`timestamptz`) — absolute instants, precomputed once at
  `Auction` creation as `raceEntry.raceDate` ± 12/5 days, converted using
  `Race.timezone` into UTC. Stored, not derived at query time, so the HYR-8
  scheduling job can do a simple indexed range scan.
- `proofDeadlineAt` (`timestamptz`, nullable) — proof-submission deadline, set
  when the auction closes to race date + 48h. Null until then. No logic in the
  data-model ticket; the closing job sets it.
- `status` (`SCHEDULED/OPEN/CLOSED`) — bidding lifecycle only. Frozen at `CLOSED`
  once the auction window ends; never mutated again afterward, even by disputes.
- `outcome` (`PENDING/AWAITING_PROOF/COMPLETED/REFUNDED/DISPUTED/FORFEITED_FEE`)
  — financial/proof resolution, independent of `status`, and can keep changing
  after `status = CLOSED` (e.g. dispute resolution flips this field, never
  `status`).
- `currentLeadingBidId` FK (nullable) — denormalized for fast reads.
- `commissionCents` Int (nullable) — actual platform cut taken, populated at
  capture time (15%/$5-min computed then, not recomputed from the bid amount at
  read time later — audit trail requirement).
- `processingFeeCents` Int (nullable) — non-refundable fee retained, populated
  only on the `FORFEITED_FEE` outcome path. Mutually exclusive with
  `commissionCents` by outcome.
- `createdAt`/`updatedAt`

**Bid**
- `id`, `auctionId` FK, `bidderId` FK, `amountCents` Int, `placedAt`
- `status` (`LEADING/OUTBID/WITHDRAWN/WON/LOST`)
- **Partial unique index**: `(auctionId) WHERE status = 'LEADING'` — DB-level
  backstop guaranteeing at most one leading bid per auction, even under
  concurrent writes. (Prisma's schema DSL does not support filtered/partial
  unique indexes directly — this index must be added via a hand-edited raw-SQL
  block in the generated migration file, not expressed as `@@unique` in
  `schema.prisma`.)
- Increment validation ($5 flat under $100, then 5%) is service-layer logic, not
  a DB constraint.
- Row-level locking/transaction strategy for the actual leading-bid transition
  (e.g. `SELECT ... FOR UPDATE` on `Auction` inside a Prisma `$transaction`) is
  explicitly deferred to the bid-placement ticket — out of scope for HYR-2,
  which only delivers the schema-level backstop above.

**EscrowTransaction** — audit log, not 1:1 with `Bid`.
- `id`, `bidId` FK (not unique — a bid can accumulate multiple transaction rows
  over its life, e.g. `AUTHORIZED` then `VOIDED` when outbid, or `AUTHORIZED`
  then `CAPTURED` then later `REFUNDED` if disputed)
- `stripePaymentIntentId`, `type`/`status`
  (`AUTHORIZED/VOIDED/CAPTURED/REFUNDED/FAILED`), `amountCents`, `createdAt`
- Only the current leading bid ever holds an active (`AUTHORIZED`, not yet
  superseded) row at a given time; prior leaders get a `VOIDED` row written when
  outbid.

### 5.6 Proof & disputes

**SponsorshipProof** — one per `Auction` (unique on `auctionId`).
- `id`, `auctionId` FK, media ref, `submittedAt`,
  `reviewStatus` (`PENDING/APPROVED/REJECTED`), `reviewedBy`, `reviewedAt`. The submission deadline lives on
  `Auction.proofDeadlineAt`, not on the proof row (a proof may not exist yet when
  the deadline is set).

**Dispute**
- `id`, `auctionId` FK, `raisedBy`, `reason`, `status`
  (`OPEN/ARBITRATION/RESOLVED_REFUND/RESOLVED_UPHELD`), `resolutionNotes`,
  `createdAt`/`resolvedAt`
- `RESOLVED_REFUND` triggers exactly one new `EscrowTransaction` row (`bidId` =
  the winning bid, `type = REFUNDED`, `amountCents` = captured amount) and flips
  `Auction.outcome` from `DISPUTED` to `REFUNDED` (terminal). Arbitration never
  reopens bidding — only `outcome` mutates, `status` stays `CLOSED`.

### 5.7 Trust & strikes

**Strike**
- `id`, `athleteId` FK, `reason`, triggering auction/dispute ref (nullable FK),
  `createdAt`
- Reserved-for-future nullable column (e.g. `excludedFromCount`/`expiresAt`-
  shaped), unused for MVP — present only so a later migration adding real strike
  expiry logic doesn't require a schema change. No expiry logic is built now.
- `Athlete.strikeCount`/`isBanned` are rollups derived from *active* strikes
  (i.e. excluding any future-flagged excluded/expired ones), not a naive
  `COUNT(*)` — so the rollup computation already accounts for the reserved
  column even though nothing sets it yet.

**TrustScoreEvent**
- `id`, `athleteId` FK, `oldValue`, `newValue`, `reason`, `createdAt`
- History log kept in addition to the mutable `Athlete.trustScore` column, so
  score progress over time can be shown later.

## 6. Migrations & constraints summary

- Prisma schema + `prisma migrate dev` locally, `prisma migrate deploy` in
  CI/prod. Migration history in `prisma/migrations/` is a single
  `20260929090000_init` migration (including the hand-written CHECK constraint
  and partial unique index).
- Unique constraints: `ZoneFloorPrice(athleteId, zone)`,
  `Auction(raceEntryId, zone)`, `RaceEntry(athleteId, raceLocalDate)`,
  `SponsorshipProof(auctionId)`, `Bidder(email)`.
- Partial unique index (raw SQL): `Bid(auctionId) WHERE status = 'LEADING'`.
- Key indexes: `Bid(auctionId, status)`, `Auction(status, openAt, closeAt)` (for
  the HYR-8 scheduling job), `EscrowTransaction(bidId, status)`, plus FK
  indexes `Bid(bidderId)`, `RaceEntry(raceId)`, `Strike(triggeringAuctionId)`.
- All monetary columns `Int` (cents). All enums as native Postgres enums via
  Prisma `enum`, each with `@@map` to a snake_case type name (`BodyZone` ->
  `body_zone`, `AuctionStatus` -> `auction_status`, etc.); raw SQL uses the
  mapped names.
- **Timestamps**: every `DateTime` column is `timestamptz` (`@db.Timestamptz(3)`),
  never bare `timestamp`. The single exception is `RaceEntry.raceLocalDate`,
  which is a `date`.
- No generic `deletedAt`/soft-delete for MVP beyond the explicit history tables
  (`Strike`, `TrustScoreEvent`) — see judgment calls below.
- **Naming**: Postgres tables and columns are snake_case (plural table names,
  e.g. `athletes`, `zone_floor_prices`), applied via Prisma `@@map`/`@map` on
  every model and field. Prisma model/field names stay camelCase in code. Raw-SQL
  migration fragments (the `CHECK` constraint and the partial unique index)
  reference the mapped snake_case names.
- **Enum comparisons in services**: `*.service.ts` never imports Prisma enums
  (hexagonal split); where a service compares an enum-valued field it declares a
  local `as const` object (not a TS enum, no cast), e.g. `RaceEntryService`
  declares `const VERIFICATION_STATUS = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' } as const;`
  and compares against `VERIFICATION_STATUS.VERIFIED`.

### 6.1 Branded types convention

Domain scalars are branded types (`Brand<T, Name>` in `src/common/brand.ts`) so a plain `string`/`number` cannot be passed where an id, email or money amount is required. `src/common` never imports `@prisma/client`.

- Ids: `AthleteId`, `RaceId`, `AuctionId`, `BidId`, `BidderId` (`ids.ts`).
- `NormalizedEmail` with `normalizeEmail(raw)` (trim + lowercase).
- `Cents` with `cents(value)`, `addCents`, `percentOfCents`.
- `StripePaymentIntentId`, `StripeCustomerId`, `StripeConnectAccountId`.
- `TrustScore` with `trustScore(value)` (integer 0..100).
- `IanaTimezone` with `ianaTimezone(value)`.

`Cents`, `TrustScore` and `IanaTimezone` validate at construction and throw on invalid input.

Casting rule: only `*.db.ts` files and the `src/common` constructors cast to a brand. Services never use `as` to a brand; they receive branded values from callers or the db layer, or build them through the `src/common` constructors. Prisma record types are returned as-is (no mapping layer), so record fields (e.g. `TrustScoreEvent.oldValue`, `Race.timezone`) stay unbranded; a brand appears only where a db method returns a scalar.

DEFERRED: `percentOfCents` rounding is currently a `Math.floor` placeholder (covered by tests). The final rounding rule is decided in HYR-9/HYR-14.

## 7. Judgment calls made — flagged for coordinator/user confirmation

All of the following were resolved via direct Q&A and a `grill-me` pass during
design, and are reflected in this spec as the locked decision. Listed here per
process requirement so the coordinator can do a final sanity check before
implementation starts:

1. **Stack choice**: NestJS v12 + Prisma + PostgreSQL, built as native ESM
   (`"type": "module"`, `NodeNext` module resolution), with Vitest as the test
   runner (no prior stack existed in this empty repo — this was a first-ticket
   judgment call, confirmed, later refined to NestJS v12/ESM/Vitest specifically).
2. **Auction = one zone per athlete per race** (9 separate auctions per
   athlete+race), not one auction with 9 nested lots — confirmed.
3. **EscrowTransaction is an audit-log table**, not 1:1 with `Bid` — only the
   current leading bid holds an active hold; prior leaders get voided rows —
   confirmed.
4. **RaceEntry join entity** gates auction creation via bib verification, with a
   denormalized `raceDate` instant plus a `raceLocalDate` (`date`, race calendar
   date in `Race.timezone`, computed by the application at creation) with a
   unique `(athleteId, raceLocalDate)` index to block same-day double entries
   regardless of start time or timezone edge cases — confirmed.
5. **Bidder identity**: keyed by email, upserted on first bid, holds Stripe
   customer id, no password — confirmed.
6. **Trust score**: mutable column + full history log (`TrustScoreEvent`) —
   confirmed.
7. **Strikes**: permanent `Strike` record table; `strikeCount`/`isBanned` are
   derived rollups from *active* strikes, with a reserved-but-unused column on
   `Strike` for future expiry logic — confirmed.
8. **Proof/dispute split**: separate `SponsorshipProof` and `Dispute` entities,
   `Auction.outcome` rolls both up — confirmed.
9. **Financial audit fields**: `commissionCents`/`processingFeeCents` stored on
   `Auction` at resolution time rather than only ever recomputed from the bid
   amount — confirmed.
10. **Race timing**: `timestamptz` everywhere + separate `Race.timezone` IANA column,
    auction window computed once at auction-creation time into absolute UTC
    instants — confirmed.
11. **Leading-bid concurrency**: partial unique index as the DB-level backstop
    now; actual row-locking/transaction strategy deferred to the bid-placement
    ticket — confirmed, but note the deferred half is *not* built in HYR-2 and
    must not be assumed complete by downstream tickets.
12. **Dispute → escrow mapping**: `status` (bidding lifecycle, frozen at
    `CLOSED`) vs `outcome` (financial resolution, keeps mutating) — confirmed.
13. **No soft-delete / generic audit trail** beyond the explicit history tables
    — not explicitly raised with the coordinator; flagged here as a residual
    assumption worth a quick confirm (rationale: nothing in MVP scope requires
    recovering a hard-deleted row, and `Strike`/`TrustScoreEvent` already cover
    the audit needs that matter for trust/strikes specifically).

## 8. Explicitly out of scope for HYR-2

- Any authentication (athlete signup/login — HYR-3).
- Deferred to HYR-3: `BidderDb.findByEmail` normalisation and athlete email
  normalisation (`BidderService.getOrCreateByEmail` already trims and lowercases).
- Deferred to HYR-5: `raceLocalDate` must be computed with one shared
  timezone-aware helper, unit-tested near midnight, and stored as a UTC-midnight
  `Date`.
- Guest bidder checkout flow itself (HYR-4) — only the `Bidder` entity exists.
- Race results ingestion/logging flow (HYR-5) — only the `Race` entity exists.
- Bib verification review UI/flow (HYR-6) — only the `RaceEntry` gate field
  exists.
- Auction scheduling job (HYR-8) — only the indexed fields it will query exist.
- Bid placement business logic, increment validation, row-locking strategy.
- Stripe integration code (webhooks, PaymentIntent creation/capture/void calls).
- Any controllers, DTOs, or HTTP surface beyond minimal reads to prove the
  schema.
