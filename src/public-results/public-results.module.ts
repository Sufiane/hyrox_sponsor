import { Module } from '@nestjs/common';
import { PublicResultsController } from './public-results.controller';
import { PublicResultsDb } from './public-results.db';
import { PublicResultsService } from './public-results.service';

@Module({
  controllers: [PublicResultsController],
  providers: [PublicResultsService, PublicResultsDb],
})
export class PublicResultsModule {}
