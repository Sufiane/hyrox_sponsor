# HYR-8: Auction Scheduling Job - Design Spec

Status: PROPOSED. Every open decision was resolved by planner judgment (no interactive Q&A was available); each is listed in section 10 for the user to confirm or overturn. Linear HYR-8 has no description; this spec is inferred from the title, the core data model spec (5.4, 5.5), the HYR-6 spec (3.5), the HYR-27 spec, and the repo.
Ticket: HYR-8 "Auction scheduling job: auto-open race-12d, auto-close race-5d" (Hyrox Sponsor MVP, M2 Auction Engine). Blocked by HYR-2, HYR-5, HYR-6, HYR-27 (all done). Blocks HYR-9 (bidding), HYR-13 (proof upload), HYR-22 (share).
Date: 2026-10-09

## 1. Context and gap

The data model already has `Auction` (`SCHEDULED/OPEN/CLOSED`, `openAt`, `closeAt`, `proofDeadlineAt`, `outcome`, `currentLeadingBidId`) with `@@unique([raceEntryId, zone])` and `@@index([status, openAt, closeAt])`. Nothing creates, opens or closes auctions yet: no `Auction` writer exists, `AuctionService` only has `getById`, and there is no scheduler dependency or cron setup. HYR-6 hard requirements on this ticket: the due-to-open query must filter `raceEntry.verificationStatus = VERIFIED` and the open step must also call `RaceEntryService.assertVerified`. HYR-27 requires the floor to be read through `ZoneFloorPriceService` and snapshotted into `Auction.floorPriceCents` at open.

So HYR-8 owns the whole auction lifecycle driver: materialize the nine zone auctions for a verified entry, open them at the window start, close them at the window end and hand a winner to the proof phase.

Goals:
1. A recurring job that, each tick, (a) creates missing `SCHEDULED` auctions for verified entries, (b) opens due auctions, (c) closes due auctions.
2. Safe to run on several app instances at once and safe to re-run (idempotent, compare-and-set transitions, no leader election).
3. Catch-up by construction: the job selects "due" rows by timestamp, so downtime or a late verification never loses an event.
4. Window math in the race's own timezone, DST-correct, in one tested helper.
5. At close, a clean contract for HYR-9/13/22: winner marked, proof deadline set, bids resolved.

Non-goals: bidding and increments (HYR-9), escrow authorize/void/capture (HYR-9/HYR-14), proof upload and the proof-deadline reminder/auto-refund job (HYR-13 and later), share links (HYR-22), staff or athlete HTTP endpoints (none; the job has no API), verification revocation, a manual "open now" admin action, notifications, any frontend.

## 2. Approaches considered

Scheduler mechanism:
- A. `@nestjs/schedule` `@Interval(60_000)` in-process task (recommended). Version 12.0.2 peers on `@nestjs/core ^11 || ^12`. Cost: one new pinned dependency (plus `cron` transitively). Gain: idiomatic Nest lifecycle (started and stopped with the app), and HYR-13/14 will need more scheduled jobs (proof deadline reminders, auto-refund), so the dependency pays off across tickets.
- B. Hand-rolled `setInterval` in `OnModuleInit`/`OnModuleDestroy`. Zero deps, about 20 lines. Honest assessment: for this ticket alone it is nearly as good as A. Rejected only because the follow-up tickets will re-implement it.
- C. External trigger (Railway cron, pg_cron, or a separate worker process hitting an endpoint). Rejected: adds an endpoint or infrastructure to secure and operate, and the hosting target is not decided.

Auction creation timing:
- A. Materialize `SCHEDULED` rows ahead of time (as soon as the entry is VERIFIED and the window has not ended), open them at `openAt` (recommended). Keeps `SCHEDULED` meaningful, lets HYR-22 or the UI show "opens on ..." later, and keeps the floor re-snapshot at open as the HYR-27 spec says.
- B. Create-and-open in one step at `openAt`, never persisting `SCHEDULED`. Fewer rows and no double snapshot, but the enum value becomes dead and nothing can reference an upcoming auction.
- C. Create when staff approves a bib (inside `ReviewVerificationUsecase`). Rejected: couples HYR-6's usecase to HYR-8, and does nothing for entries approved before this ships.

Multi-instance safety:
- A. Idempotent compare-and-set writes, no lock (recommended). Concurrent ticks waste a little work but cannot double-apply.
- B. Postgres advisory lock so only one instance ticks. More moving parts (connection-scoped locks fight Prisma's pool), no correctness gain over A.

## 3. Design

### 3.1 Tick

`AuctionSchedulerTask` (`src/auctions/auction-scheduler.task.ts`, `@Interval(60_000)`) calls `AuctionService.runLifecycleTick(now)` with `now = new Date()`. Guards:
- Skips when env `AUCTION_SCHEDULER_ENABLED` is `false` (default `true`), so a web-only replica or a local second workspace can turn it off.
- Skips when the previous tick in this process is still running (`running` flag).
- Catches everything and logs; a thrown error never escapes the interval callback.
- Logs one line per tick only when something changed (counts), plus errors.

`AuctionService.runLifecycleTick(now: Date): Promise<LifecycleTickResult>` runs three usecases in order, each isolated (one failing does not skip the others, the error is logged and the phase count is 0):
1. `MaterializeAuctionsUsecase`
2. `OpenAuctionsUsecase`
3. `CloseAuctionsUsecase`

Usecase layer is warranted: three distinct operations with their own queries, rules and helpers. Each lives in `src/auctions/usecases/<name>/` with `<name>.usecase.ts`, `<name>.usecase.db.ts`, `<name>.module.ts`, and specs, matching `src/races/usecases/*`. Direction is task -> service -> usecase -> usecase db. `AuctionService` stays a thin delegate plus the existing `getById`. Each usecase db is its own class with only its queries (no shared general db, so no interim-interface shortcut is taken).

All three phases page through candidates by `id` cursor (page size 100) until exhausted. This avoids both starvation by a stuck row and an unbounded single read; after an outage the whole backlog drains in one tick.

### 3.2 Window math

New pure helper `src/auctions/auction-window.ts`:

```
OPEN_DAYS_BEFORE_RACE = 12
CLOSE_DAYS_BEFORE_RACE = 5
PROOF_WINDOW_HOURS = 48
auctionWindow(raceLocalDate: Date, timezone: IanaTimezone): { openAt: Date; closeAt: Date }
proofDeadline(raceDate: Date): Date
```

`openAt` = 00:00 race-local of (`raceLocalDate` - 12 calendar days); `closeAt` = 00:00 race-local of (`raceLocalDate` - 5 calendar days). Window is "day -12 start to day -5 start": 7 calendar days, 168 h except across a DST change (167 or 169 h). It uses the immutable `RaceEntry.raceLocalDate` and `Race.timezone`, never re-derives from the instant. `proofDeadline` = `raceDate` + 48 h (data model 5.5; absolute hours, not calendar).

Needs one new timezone helper `src/common/zoned-time.ts`: `instantAtLocalMidnight(localDate: Date, timezone: IanaTimezone): Date` built on `Intl` (two-pass offset correction). Where local midnight does not exist (zone skips 00:00 on a DST change) it resolves to the first valid instant of that day. Tested at DST start and end in `America/Chicago`, `America/Los_Angeles`, plus a southern-hemisphere zone and a zone skipping midnight (`America/Sao_Paulo` rules as observed by the ICU data in Node 24, otherwise `America/Havana`). This is the "one timezone-aware helper tested near midnight" the conventions note called for.

### 3.3 Materialize phase

Candidates: `RaceEntry` with `verificationStatus = VERIFIED`, `auctions: { none: {} }`, `raceDate > now`, athlete not banned. Select `id, athleteId, raceLocalDate, race.timezone` (timezone branded via `ianaTimezone()` in the db).

Per entry: compute window; skip if `closeAt <= now` (too late to auction; no rows created, logged at debug-level warn once per tick count only). Otherwise `RaceEntryService.assertVerified` (defense in depth; on `ConflictError`/`NotFoundError` log and skip), read the nine floors with one `ZoneFloorPriceService.listForAthlete(athleteId)` call, and `createMany({ skipDuplicates: true })` nine rows: `zone` (all nine `ZONE_ORDER`), `status SCHEDULED`, `outcome PENDING`, `openAt`, `closeAt`, `floorPriceCents` from the athlete's price (default $10). The initial floor only satisfies NOT NULL; the real snapshot happens at open.

If the entry is verified after `openAt`, rows are created and opened in the same tick: window shortened, `closeAt` unchanged (HYR-6 3.5 question, see J6).

### 3.4 Open phase

Due: `status = SCHEDULED AND openAt <= now AND closeAt > now AND raceEntry.verificationStatus = VERIFIED AND raceEntry.athlete.isBanned = false` (satisfies HYR-6's mandatory VERIFIED filter in the query itself).

Per auction (floors cached per athlete within the tick): `assertVerified` on its entry (skip with warn if it throws), then compare-and-set `updateMany` with the same predicates plus `id`, setting `status OPEN` and `floorPriceCents` to the athlete's current price for that zone. Count 0 means another instance or a concurrent change won; ignored. Floor edits made after materialization but before open are honored; edits after open never retroact.

### 3.5 Close phase

Due: `status IN (SCHEDULED, OPEN) AND closeAt <= now`. Including `SCHEDULED` closes auctions that never opened (banned athlete, unverified at the time, long outage) so no row is left dangling past its window.

Per auction, one DB transaction in `CloseAuctionsUsecaseDb.closeAuction(id, now, proofDeadlineAt)`:
1. Compare-and-set `updateMany` `status -> CLOSED` where `id`, `status IN (SCHEDULED, OPEN)`, `closeAt <= now`. This takes the auction row lock. Count 0: return `already_closed`.
2. Read the bid with `status = LEADING` for the auction (the partial unique index guarantees at most one).
3. No leading bid: set `outcome = NO_SALE` on the auction. Result `no_sale`.
4. Leading bid: set it `WON`; set every `OUTBID` bid to `LOST` (`WITHDRAWN` untouched); set auction `outcome = AWAITING_PROOF`, `proofDeadlineAt`. Result `won`.

The usecase computes `proofDeadlineAt = proofDeadline(raceDate)` and passes it in; the db decides win versus no-sale because that check must be atomic with the row lock. This is the one place a db method carries a small branch; it is deliberate and approved by the user. `currentLeadingBidId` is left as is (it already names the winner; HYR-9 maintains it).

No-sale representation: `status CLOSED`, `outcome NO_SALE`, `currentLeadingBidId null`, `proofDeadlineAt null`. `NO_SALE` is a new `AuctionOutcome` value added by this ticket (section 3.8). It is terminal and is also the outcome of a never-opened `SCHEDULED` auction that passed `closeAt`. The no-sale branch of `closeAuction` sets it inside the same transaction as the status flip, so a closed auction never carries `PENDING`.

No escrow side effects: the winning bid's authorization is not captured here (capture happens on proof approval, HYR-14). HYR-8 never calls Stripe.

### 3.6 Contract for dependents

- HYR-9 (bidding): accept a bid only when `status = OPEN AND closeAt > now` evaluated under the auction row lock (the lock the bid-placement ticket was already deferred to add). It must check `closeAt`, not only `status`, because the job lags up to about 60 s. Close and bid placement then serialize on the same row.
- HYR-13 (proof): consumes `outcome = AWAITING_PROOF` and `proofDeadlineAt`.
- HYR-22 (share): only `OPEN` auctions are shareable for bidding; `SCHEDULED` rows exist for "opens on" displays.
- Hold lifetime risk for HYR-9/HYR-14 (no HYR-8 change): the authorization is placed at bid time, not at close. A bid placed right at open (race-12d) stays held until capture or void after proof, about race+48h, so up to roughly 14 days. Stripe card authorization holds commonly expire at 7 days, so opening later does not fix this in general. The fix belongs to the bidding and escrow tickets, for example saving the card with a SetupIntent and authorizing or charging at close, or re-authorizing before expiry. HYR-8 neither depends on nor changes this; flagged only.
- Consumers of `AuctionOutcome` must now treat `NO_SALE` as terminal: HYR-13 (proof) must not expect a proof for it, and HYR-14 (payout/refund) has nothing to capture or void for it. A repo-wide search found no existing code switching on `AuctionOutcome` (section 3.8).

### 3.7 Config and wiring

- Add `@nestjs/schedule` pinned to `12.0.2` (exact, no caret). `ScheduleModule.forRoot()` in `AppModule`.
- `AuctionsModule` imports the three usecase modules, `RacesModule` (for `RaceEntryService`) and `ZonesModule` (for `ZoneFloorPriceService`); provides `AuctionSchedulerTask`. No circular import: neither Races nor Zones imports Auctions.
- Env `AUCTION_SCHEDULER_ENABLED` validated in `EnvironmentVariables` (boolean from the strings `true`/`false`, default true); document in README and `.env.example`.
- Prisma schema change for `NO_SALE` only (section 3.8). Existing index `[status, openAt, closeAt]` serves open and close scans.

### 3.8 Schema change: `NO_SALE`

- `prisma/schema.prisma`: append `NO_SALE` to `enum AuctionOutcome` (mapped enum `auction_outcome`, unchanged name).
- Hand-written migration `prisma/migrations/20261009100000_auction_outcome_no_sale/migration.sql`: `ALTER TYPE "auction_outcome" ADD VALUE 'NO_SALE';`. Appending matches the Prisma enum order, so `migrate diff` stays empty. Postgres 16 allows `ADD VALUE` in a transaction as long as the new value is not used in the same transaction; the migration does not use it. It is not removable later without recreating the type, which is acceptable for a terminal outcome.
- Verify with the shadow-database `migrate diff` procedure in `README.md` (expected: empty migration).
- Exhaustive-switch audit (repo-wide search of `src`, `shared`, `web`, `prisma`, README): `AuctionOutcome` and its values are referenced only in `prisma/schema.prisma` and the init migration. No TypeScript, Svelte, shared or web code switches on it, so no code needs an update beyond this ticket's own. Documentation that lists the outcomes: `docs/specs/2026-09-28-core-data-model-design.md` section 5.5 (add `NO_SALE` to the list) and this spec. Future consumers (HYR-13, HYR-14, HYR-22) must handle `NO_SALE`; no `satisfies never` guard exists today to enforce it, which is out of scope here.

## 4. Error handling

Domain errors keep snake_case codes; nothing here reaches HTTP. Per-auction and per-entry failures are caught inside the usecase loop, logged with ids via `Logger.warn`/`error`, and the loop continues, so one bad row cannot block the rest. A row that keeps failing is retried every tick and is visible in logs; no dead-letter table for MVP.

## 5. Testing

Vitest, nested `describe` per condition, mocks via `vitest-mock-extended` as in `src/races/usecases/review-verification/review-verification.usecase.spec.ts`. `now` is passed as a parameter, so no fake timers are needed for the usecases.

- `zoned-time.spec.ts` and `auction-window.spec.ts`: table tests incl. DST start/end, a race on the first/last day of a month and year, date-line zones.
- Usecase specs: skip when `closeAt <= now`; late verification opens the same tick; skips when `assertVerified` throws; floor snapshot uses the athlete price or the default; CAS count 0 is ignored; close with winner, close with no bids, close of a never-opened `SCHEDULED` auction, close already done; failure in one row does not stop the next; paging continues until a short page.
- Usecase db specs: queries carry the VERIFIED filter, banned filter and CAS predicates (pattern of `log-race.usecase.db.spec.ts`).
- `auction.service.spec.ts`: phases run in order, one phase failing does not skip the others, counts aggregated.
- Task spec: disabled flag, overlap guard, error swallowed and logged.
- `env.validation.spec.ts`: flag parsing and default.
- Manual end-to-end (QA): against the 5435 database, seed a verified entry with `raceDate` such that `openAt` is in the past, run one tick, observe nine `OPEN` rows with the right floors; move `closeAt` into the past, tick again, observe `CLOSED`, winner `WON`, others `LOST`, `proofDeadlineAt = raceDate + 48h`. Run two app instances to confirm no double effect.

## 6. Security and abuse

No inbound surface. The job only writes to `auctions` and `bids` rows it selects by predicate. Banned athletes get no new auctions. Verification gate enforced in both query and `assertVerified`.

## 7. Files

New: `prisma/migrations/20261009100000_auction_outcome_no_sale/migration.sql`, `src/common/zoned-time.ts` (+spec), `src/auctions/auction-window.ts` (+spec), `src/auctions/auction-scheduler.task.ts` (+spec), `src/auctions/usecases/{materialize-auctions,open-auctions,close-auctions}/*` (usecase, usecase.db, module, specs). Modified: `prisma/schema.prisma`, `docs/specs/2026-09-28-core-data-model-design.md` (outcome list note), `src/auctions/auction.service.ts` (+spec), `src/auctions/auctions.module.ts`, `src/app.module.ts`, `src/config/env.validation.ts` (+spec), `package.json` and `package-lock.json`, `README.md`, `.env.example`.

## 8. Frontend

None. No endpoint is added and the body map UI is untouched. The plan is backend-only.

## 9. Risks

- Clock source is each instance's `new Date()`; skew between instances only shifts a transition by the skew, and CAS makes it safe.
- Every transition happens within about 60 s of its timestamp, never before it.
- An app with the scheduler disabled everywhere stalls auctions silently; the per-tick log line and the README note mitigate. No alerting in MVP.

## 10. Decisions resolved by judgment (confirm or overturn)

- J1 Scheduler: `@nestjs/schedule` `@Interval(60_000)`, pinned 12.0.2, enable flag env. Alternative: dependency-free `setInterval`.
- J2 Multi-instance: CAS and `createMany skipDuplicates`, no lock, no leader election.
- J3 Window boundaries: local midnight of race-local day -12 (open) and day -5 (close), 7 calendar days, via a new DST-correct helper. Alternative rejected: `raceDate` minus N x 24 h (drifts an hour across DST and ignores the race's local day).
- J4 Which auctions: all nine zones for every verified, non-banned entry, whether or not the athlete saved a price (default $10 minimum). HYR-27 explicitly deferred per-zone enable/disable.
- J5 Auction rows are materialized early as `SCHEDULED` by the job itself (not by the verification flow); floor is snapshotted again at open.
- J6 Late verification: if verified after `openAt` but before `closeAt`, open at next tick with the original `closeAt` (shortened window). If `closeAt` already passed, never create auctions.
- J7 Banned athletes: no new auctions, no opening; their already-open auctions are not touched (ban handling belongs to the trust tickets).
- J8 (small db branch approved by user) Close with a bid: leading bid `WON`, `OUTBID` bids `LOST`, `outcome AWAITING_PROOF`, `proofDeadlineAt = raceDate + 48h`, no escrow capture.
- J9 (REVISED by user) Close with no bids: `CLOSED` + outcome `NO_SALE` + no proof deadline. New `NO_SALE` enum value with a migration.
- J10 `SCHEDULED` auctions past `closeAt` (never opened) are closed with outcome `NO_SALE` rather than left dangling (confirmed by user).
- J11 Paging by id cursor, page 100, drain fully each tick; per-row error isolation; no retry/dead-letter table.
- J12 `AuctionService` runs materialize then open as one chain, with close concurrent (close and open select disjoint rows by `closeAt`); a failed phase does not stop the next.
- J13 HYR-9 contract: bids require `status OPEN AND closeAt > now` under the row lock.
- J14 (REVISED by user) Authorization-hold lifetime risk is flagged for HYR-9/HYR-14: authorization happens at bid time, so a bid at open is held up to about 14 days; no HYR-8 change.
- J15 Grill step: `grill-me` is interactive and no user was reachable, so the risky branches (DST math, concurrent close vs bid, late verification, stuck-row starvation) were stress-tested by the planner and are covered by J3, J6, J11, J13 and the test list above.
