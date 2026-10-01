import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AthleteId } from '../common/ids.js';
import { AthleteDb } from './athlete.db.js';

type AthleteRecord = NonNullable<Awaited<ReturnType<AthleteDb['findById']>>>;

@Injectable()
export class AthleteService {
  private readonly logger = new Logger(AthleteService.name);

  constructor(private readonly db: AthleteDb) {}

  async getById(id: AthleteId): Promise<AthleteRecord> {
    const athlete = await this.db.findById(id);

    if (!athlete) {
      this.logger.warn(`Athlete ${id} not found`);

      throw new NotFoundException('athlete_not_found');
    }

    return athlete;
  }
}
