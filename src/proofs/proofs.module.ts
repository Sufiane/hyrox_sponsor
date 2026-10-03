import { Module } from '@nestjs/common';
import { SponsorshipProofDb } from './sponsorship-proof.db';
import { SponsorshipProofService } from './sponsorship-proof.service';

@Module({
  providers: [SponsorshipProofService, SponsorshipProofDb],
  exports: [SponsorshipProofService],
})
export class ProofsModule {}
