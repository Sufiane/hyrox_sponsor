import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { AthletesModule } from './athletes/athletes.module.js';
import { BiddersModule } from './bidders/bidders.module.js';
import { ZonesModule } from './zones/zones.module.js';
import { RacesModule } from './races/races.module.js';

@Module({
  imports: [PrismaModule, AthletesModule, BiddersModule, ZonesModule, RacesModule],
})
export class AppModule {}
