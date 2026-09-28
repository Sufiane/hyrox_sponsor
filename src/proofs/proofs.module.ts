import { Module } from '@nestjs/common';
import { SponsorshipProofDb } from './sponsorship-proof.db.js';
import { SponsorshipProofService } from './sponsorship-proof.service.js';

@Module({
  providers: [SponsorshipProofService, SponsorshipProofDb],
  exports: [SponsorshipProofService],
})
export class ProofsModule {}
