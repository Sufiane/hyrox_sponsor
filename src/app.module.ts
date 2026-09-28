import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { AthletesModule } from './athletes/athletes.module.js';
import { BiddersModule } from './bidders/bidders.module.js';

@Module({
  imports: [PrismaModule, AthletesModule, BiddersModule],
})
export class AppModule {}
