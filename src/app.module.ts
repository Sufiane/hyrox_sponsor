import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { AthletesModule } from './athletes/athletes.module.js';

@Module({
  imports: [PrismaModule, AthletesModule],
})
export class AppModule {}
