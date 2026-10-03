-- CreateIndex
CREATE UNIQUE INDEX "bidders_stripe_customer_id_key" ON "bidders"("stripe_customer_id");

-- Hand-written: bidders.email must already be trimmed and lowercased (NormalizedEmail invariant)
ALTER TABLE "bidders" ADD CONSTRAINT "bidders_email_normalized_check"
  CHECK ("email" = lower(btrim("email")));
