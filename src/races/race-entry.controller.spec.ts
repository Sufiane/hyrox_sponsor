import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { RaceEntryController } from './race-entry.controller';
import { RaceEntryService } from './race-entry.service';
import type { IanaTimezone } from '../common/iana-timezone';
import type { AthleteId } from '../common/ids';
import type { AthleteParamsDto } from '../athletes/dto/athlete-params.dto';
import type { LogRaceDto } from './dto/log-race.dto';

describe('RaceEntryController', () => {
  let service: DeepMockProxy<RaceEntryService>;
  let controller: RaceEntryController;

  beforeEach(() => {
    service = mockDeep<RaceEntryService>();
    controller = new RaceEntryController(service);
  });

  describe('logRace', () => {
    const entry = { id: 'entry-1' };
    const params = { athleteId: 'athlete-1' as AthleteId } as AthleteParamsDto;
    const body: LogRaceDto = {
      name: 'Hyrox Chicago',
      date: new Date('2026-11-14T15:00:00Z'),
      timezone: 'America/Chicago' as IanaTimezone,
      location: 'Chicago, IL',
      division: 'SINGLE_OPEN_MEN',
    };

    beforeEach(() => {
      service.logRace.mockResolvedValue(entry as never);
    });

    it('maps the body to a plain input for the service', async () => {
      await controller.logRace(params, body);

      expect(service.logRace).toHaveBeenCalledWith('athlete-1', {
        name: 'Hyrox Chicago',
        date: new Date('2026-11-14T15:00:00Z'),
        timezone: 'America/Chicago',
        location: 'Chicago, IL',
        division: 'SINGLE_OPEN_MEN',
      });
    });

    it('does not pass the DTO instance through', async () => {
      await controller.logRace(params, body);

      expect(service.logRace.mock.calls[0][1]).not.toBe(body);
    });

    it('returns the service result', async () => {
      const result = await controller.logRace(params, body);

      expect(result).toBe(entry);
    });
  });
});
