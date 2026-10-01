import { Module } from '@nestjs/common';
import { DisputeDb } from './dispute.db.js';
import { DisputeService } from './dispute.service.js';

@Module({
  providers: [DisputeService, DisputeDb],
  exports: [DisputeService],
})
export class DisputesModule {}
