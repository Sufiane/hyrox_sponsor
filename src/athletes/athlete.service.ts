import { Injectable, NotFoundException } from '@nestjs/common';
import type { AthleteId } from '../common/index.js';
import { AthleteDb } from './athlete.db.js';

type AthleteRecord = NonNullable<Awaited<ReturnType<AthleteDb['findById']>>>;

@Injectable()
export class AthleteService {
  constructor(private readonly db: AthleteDb) {}

  async getById(id: AthleteId): Promise<AthleteRecord> {
    const athlete = await this.db.findById(id);

    if (!athlete) {
      throw new NotFoundException(`Athlete ${id} not found`);
    }

    return athlete;
  }
}
