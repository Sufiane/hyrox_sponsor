-- AddForeignKey
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_triggering_auction_id_fkey" FOREIGN KEY ("triggering_auction_id") REFERENCES "auctions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
