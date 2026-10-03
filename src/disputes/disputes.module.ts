import { Module } from '@nestjs/common';
import { DisputeDb } from './dispute.db';
import { DisputeService } from './dispute.service';

@Module({
  providers: [DisputeService, DisputeDb],
  exports: [DisputeService],
})
export class DisputesModule {}
