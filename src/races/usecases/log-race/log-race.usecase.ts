import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/domain-error';
import type { AthleteId } from '../../../common/ids';
import { localDateInTimezone } from '../../../common/local-date';
import { raceNameKey } from '../../race-name-key';
import type { LogRaceInput } from './log-race-input';
import { LogRaceUsecaseDb, type RaceEntryWithRace } from './log-race.usecase.db';

export type LogRaceResult = RaceEntryWithRace;

@Injectable()
export class LogRaceUsecase {
  private readonly logger = new Logger(LogRaceUsecase.name);

  constructor(private readonly db: LogRaceUsecaseDb) {}

  async execute(athleteId: AthleteId, input: LogRaceInput): Promise<LogRaceResult> {
    const athlete = await this.db.findAthleteStanding(athleteId);

    if (!athlete) {
      this.logger.warn(`Athlete ${athleteId} not found`);

      throw new NotFoundError('athlete_not_found');
    }

    if (athlete.isBanned) {
      this.logger.warn(`Athlete ${athleteId} is banned and cannot log a race`);

      throw new ForbiddenError('athlete_banned');
    }

    const raceLocalDate = localDateInTimezone(input.date, input.timezone);
    const entry = await this.db.createEntry({
      athleteId,
      race: {
        name: input.name,
        nameKey: raceNameKey(input.name),
        date: input.date,
        timezone: input.timezone,
        location: input.location,
      },
      division: input.division,
      raceLocalDate,
    });

    if (!entry) {
      this.logger.warn(
        `Athlete ${athleteId} already has a race entry on ${raceLocalDate.toISOString().slice(0, 10)}`,
      );

      throw new ConflictError('race_entry_date_conflict');
    }

    return entry;
  }
}
