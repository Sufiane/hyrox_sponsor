-- Hand-written (not modelled by Prisma): any change of the default payment method invalidates bidder tokens (HYR-59 Q15), whoever writes it.
-- The trigger overrides any explicit token_version in the same UPDATE when the payment method changes.
CREATE FUNCTION "bump_bidder_token_version"() RETURNS trigger AS $$
BEGIN
  IF NEW."default_payment_method_id" IS DISTINCT FROM OLD."default_payment_method_id" THEN
    NEW."token_version" := OLD."token_version" + 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bidders_bump_token_version"
BEFORE UPDATE ON "bidders"
FOR EACH ROW EXECUTE FUNCTION "bump_bidder_token_version"();
