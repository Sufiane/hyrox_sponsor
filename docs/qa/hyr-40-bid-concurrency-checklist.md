# HYR-40 bid concurrency: manual QA checklist

Automated coverage: HYR-39 real-Postgres race suite (`npm run test:integration`). This checklist exercises the HTTP layer end to end.

## Prerequisites

- [ ] Postgres up on the shared port and migrations applied.
- [ ] API running with `TRUST_PROXY_HOPS=0`.
- [ ] A seeded OPEN auction; export `ID=<auction id>`, `BASE=http://localhost:3000`, `FLOOR=<floor_price_cents>`.
- [ ] `AUCTION_SCHEDULER_ENABLED=false` for steps 2 to 4 (set it back to `true` for step 5).

## Checks

1. [ ] Happy path: `curl -X POST $BASE/auctions/$ID/bids -H 'Content-Type: application/json' -d "{\"email\":\"a@x.com\",\"amountCents\":$FLOOR}"` returns 201, has no bidder fields, and `minimumNextBidCents` equals amount plus the increment ($5 under $100, 5% rounded up from $100).
2. [ ] Parallel identical bids: 10 background `curl`s (`&` then `wait`) with distinct emails and the same amount. Exactly one 201, the rest 400 `bid_below_minimum`. Verify one LEADING row and that the pointer matches:
   `select b.id, b.status from bids b where b.auction_id = '<id>' and b.status = 'LEADING';` and `select current_leading_bid_id from auctions where id = '<id>';`
3. [ ] Parallel ascending bids: distinct emails, amounts `FLOOR + n * increment` for n = 0..9 fired together. Exactly one LEADING row, equal to the highest accepted amount; every other accepted bid is OUTBID.
4. [ ] Same email twice in parallel: one 201, one 409 `already_leading`.
5. [ ] Race with the close job (scheduler enabled): set `close_at` about 5 s ahead, then send one bid every 200 ms with rising amounts across the boundary. Afterwards: no LEADING bid on a CLOSED auction; the last accepted bid is `WON` (or outcome `NO_SALE` when no bids); bids after close return 409 `auction_not_open`. Repeat 3 times.
6. [ ] Error spot checks: unknown auction id 404; athlete's own email 403 `self_bid_not_allowed`; amount above 100000000 400 `bid_above_maximum`; amount 0 400 `validation_failed`; extra `bidderId` field 400 `validation_failed`.
7. [ ] Throttle: 11 requests in one minute from one client, the 11th is 429. With `TRUST_PROXY_HOPS=1` and different `X-Forwarded-For` values the buckets are separate.
