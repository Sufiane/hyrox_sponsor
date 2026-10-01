import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { RaceId } from '../common/ids.js';
import { RaceDb } from './race.db.js';

type RaceRecord = NonNullable<Awaited<ReturnType<RaceDb['findById']>>>;

@Injectable()
export class RaceService {
  private readonly logger = new Logger(RaceService.name);

  constructor(private readonly db: RaceDb) {}

  async getById(id: RaceId): Promise<RaceRecord> {
    const race = await this.db.findById(id);

    if (!race) {
      this.logger.warn(`Race ${id} not found`);

      throw new NotFoundException('race_not_found');
    }

    return race;
  }
}
