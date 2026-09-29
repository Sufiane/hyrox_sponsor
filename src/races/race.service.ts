import { Injectable, NotFoundException } from '@nestjs/common';
import type { RaceId } from '../common/index.js';
import { RaceDb } from './race.db.js';

type RaceRecord = NonNullable<Awaited<ReturnType<RaceDb['findById']>>>;

@Injectable()
export class RaceService {
  constructor(private readonly db: RaceDb) {}

  async getById(id: RaceId): Promise<RaceRecord> {
    const race = await this.db.findById(id);

    if (!race) {
      throw new NotFoundException(`Race ${id} not found`);
    }

    return race;
  }
}
