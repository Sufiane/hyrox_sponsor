import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { LogRaceUsecaseDb, type CreateEntryParams } from './log-race.usecase.db';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AthleteId } from '../../../common/ids';
import type { IanaTimezone } from '../../../common/iana-timezone';

describe('LogRaceUsecaseDb', () => {
  const params: CreateEntryParams = {
    athleteId: 'athlete-1' as AthleteId,
    race: {
      name: 'Hyrox Chicago',
      nameKey: 'hyrox_chicago',
      date: new Date('2026-11-14T15:00:00Z'),
      timezone: 'America/Chicago' as IanaTimezone,
      location: 'Chicago, IL',
    },
    division: 'SINGLE_OPEN_MEN',
    raceLocalDate: new Date('2026-11-14T00:00:00Z'),
  };
  const raceKey = {
    nameKey_date_timezone: {
      nameKey: 'hyrox_chicago',
      date: params.race.date,
      timezone: 'America/Chicago',
    },
  };
  const race = { id: 'race-1' };
  const entry = { id: 'entry-1', race };
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<PrismaService>;
  let db: LogRaceUsecaseDb;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(((callback: (client: unknown) => unknown) => callback(tx)) as never);
    tx.raceEntry.create.mockResolvedValue(entry as never);
    db = new LogRaceUsecaseDb(prisma);
  });

  describe('findAthleteStanding', () => {
    describe('when the athlete exists', () => {
      beforeEach(() => {
        prisma.athlete.findUnique.mockResolvedValue({ isBanned: true } as never);
      });

      it('returns the ban flag', async () => {
        const result = await db.findAthleteStanding(params.athleteId);

        expect(result).toEqual({ isBanned: true });
      });

      it('selects only the ban flag', async () => {
        await db.findAthleteStanding(params.athleteId);

        expect(prisma.athlete.findUnique).toHaveBeenCalledWith({
          where: { id: 'athlete-1' },
          select: { isBanned: true },
        });
      });
    });

    describe('when the athlete does not exist', () => {
      beforeEach(() => {
        prisma.athlete.findUnique.mockResolvedValue(null);
      });

      it('returns null', async () => {
        const result = await db.findAthleteStanding(params.athleteId);

        expect(result).toBeNull();
      });
    });
  });

  describe('when the race already exists', () => {
    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(race as never);
    });

    it('reuses it without inserting', async () => {
      await db.createEntry(params);

      expect(tx.race.createMany).not.toHaveBeenCalled();
      expect(tx.raceEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ raceId: 'race-1' }) }),
      );
    });

    it('looks the race up by its unique key', async () => {
      await db.createEntry(params);

      expect(tx.race.findUnique).toHaveBeenCalledWith({ where: raceKey });
    });

    it('returns the created entry', async () => {
      const result = await db.createEntry(params);

      expect(result).toBe(entry);
    });
  });

  describe('when the race does not exist', () => {
    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(null);
      tx.race.findUniqueOrThrow.mockResolvedValue(race as never);
      tx.race.createMany.mockResolvedValue({ count: 1 });
    });

    it('inserts it skipping duplicates', async () => {
      await db.createEntry(params);

      expect(tx.race.createMany).toHaveBeenCalledWith({
        data: [
          {
            name: 'Hyrox Chicago',
            nameKey: 'hyrox_chicago',
            date: params.race.date,
            timezone: 'America/Chicago',
            location: 'Chicago, IL',
          },
        ],
        skipDuplicates: true,
      });
    });

    it('re-finds it by its unique key', async () => {
      await db.createEntry(params);

      expect(tx.race.findUniqueOrThrow).toHaveBeenCalledWith({ where: raceKey });
    });
  });

  describe('when another writer inserts the same race concurrently', () => {
    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(null);
      tx.race.findUniqueOrThrow.mockResolvedValue({ id: 'race-other' } as never);
      tx.race.createMany.mockResolvedValue({ count: 0 });
    });

    it('reuses the other writer row without erroring', async () => {
      await db.createEntry(params);

      expect(tx.raceEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ raceId: 'race-other' }) }),
      );
    });
  });

  describe('when the entry insert violates the athlete and local date index', () => {
    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(race as never);
      tx.raceEntry.create.mockRejectedValue({ code: 'P2002', meta: { target: ['athlete_id', 'race_local_date'] } });
    });

    it('returns null', async () => {
      const result = await db.createEntry(params);

      expect(result).toBeNull();
    });
  });

  describe('when a unique violation names a different target', () => {
    const failure = { code: 'P2002', meta: { target: ['name_key', 'date', 'timezone'] } };

    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(race as never);
      tx.raceEntry.create.mockRejectedValue(failure);
    });

    it('rethrows it', async () => {
      await expect(db.createEntry(params)).rejects.toBe(failure);
    });
  });

  describe('when the entry insert fails for any other reason', () => {
    const failure = new Error('boom');

    beforeEach(() => {
      tx.race.findUnique.mockResolvedValue(race as never);
      tx.raceEntry.create.mockRejectedValue(failure);
    });

    it('rethrows it', async () => {
      await expect(db.createEntry(params)).rejects.toBe(failure);
    });
  });
});
