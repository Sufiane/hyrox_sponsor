import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AthleteService } from './athlete.service';
import { AthleteDb } from './athlete.db';
import type { AthleteId } from '../common/ids';
import type { NormalizedEmail } from '../common/email';
import type { PasswordHash } from '../common/password-hash';
import { CURRENT_TOS_VERSION } from '../common/tos-version';

describe('AthleteService', () => {
  let db: DeepMockProxy<AthleteDb>;
  let service: AthleteService;

  beforeEach(async () => {
    db = mockDeep<AthleteDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [AthleteService, { provide: AthleteDb, useValue: db }],
    }).compile();
    service = moduleRef.get(AthleteService);
  });

  describe('getById', () => {
    describe('when the athlete exists', () => {
      const athlete = { id: 'athlete-1', name: 'Jamie Lee' };

      beforeEach(() => {
        db.findById.mockResolvedValue(athlete as never);
      });

      it('returns the athlete', async () => {
        const result = await service.getById('athlete-1' as AthleteId);

        expect(result).toEqual(athlete);
      });
    });

    describe('when the athlete does not exist', () => {
      let warn: MockInstance;

      beforeEach(() => {
        db.findById.mockResolvedValue(null);
        warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });

      afterEach(() => {
        warn.mockRestore();
      });

      it('throws NotFoundException', async () => {
        await expect(service.getById('missing' as AthleteId)).rejects.toThrow(NotFoundException);
      });

      it('throws the athlete_not_found code', async () => {
        await expect(service.getById('missing' as AthleteId)).rejects.toThrow('athlete_not_found');
      });

      it('logs the missing id', async () => {
        await service.getById('missing' as AthleteId).catch(() => undefined);

        expect(warn).toHaveBeenCalledWith('Athlete missing not found');
      });
    });
  });

  describe('findByEmail', () => {
    const email = 'jamie@example.com' as NormalizedEmail;

    describe('when the athlete exists', () => {
      it('returns the athlete', async () => {
        db.findByEmail.mockResolvedValue({ id: 'athlete-1' } as never);

        expect(await service.findByEmail(email)).toEqual({ id: 'athlete-1' });
      });
    });

    describe('when the athlete does not exist', () => {
      it('returns null', async () => {
        db.findByEmail.mockResolvedValue(null);

        expect(await service.findByEmail(email)).toBeNull();
      });
    });
  });

  describe('assertAdultAttested', () => {
    describe('when adultAttested is not true', () => {
      it.each([false, undefined])('rejects %s with adult_attestation_required', (adultAttested) => {
        expect(() => service.assertAdultAttested(adultAttested)).toThrow('adult_attestation_required');
      });
    });

    describe('when adultAttested is true', () => {
      it('does not throw', () => {
        expect(() => service.assertAdultAttested(true)).not.toThrow();
      });
    });
  });

  describe('assertTosAccepted', () => {
    let warn: MockInstance;

    beforeEach(() => {
      warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    describe('when tosVersion is undefined', () => {
      it('rejects with tos_acceptance_required', () => {
        expect(() => service.assertTosAccepted(undefined)).toThrow('tos_acceptance_required');
      });

      it('throws BadRequestException', () => {
        expect(() => service.assertTosAccepted(undefined)).toThrow(BadRequestException);
      });

      it('logs a warning', () => {
        expect(() => service.assertTosAccepted(undefined)).toThrow();

        expect(warn).toHaveBeenCalledTimes(1);
      });
    });

    describe('when tosVersion is not the current version', () => {
      it('rejects with tos_version_mismatch', () => {
        expect(() => service.assertTosAccepted('old-version')).toThrow('tos_version_mismatch');
      });

      it('throws BadRequestException', () => {
        expect(() => service.assertTosAccepted('old-version')).toThrow(BadRequestException);
      });

      it('logs the received and current versions', () => {
        expect(() => service.assertTosAccepted('old-version')).toThrow();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('old-version'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(CURRENT_TOS_VERSION));
      });
    });

    describe('when tosVersion is the current version', () => {
      it('returns the current version', () => {
        expect(service.assertTosAccepted(CURRENT_TOS_VERSION)).toBe(CURRENT_TOS_VERSION);
      });
    });
  });

  describe('register', () => {
    const input = {
      name: 'Jamie Lee',
      email: 'jamie@example.com' as NormalizedEmail,
      passwordHash: '$argon2id$x' as PasswordHash,
      tosVersion: CURRENT_TOS_VERSION,
    };
    let warn: MockInstance;

    beforeEach(() => {
      warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warn.mockRestore();
      vi.useRealTimers();
    });

    describe('when adultAttested is not true', () => {
      it.each([false, undefined])('rejects %s with adult_attestation_required', async (adultAttested) => {
        await expect(service.register({ ...input, adultAttested })).rejects.toThrow('adult_attestation_required');
      });

      it('throws BadRequestException', async () => {
        await expect(service.register({ ...input, adultAttested: false })).rejects.toThrow(BadRequestException);
      });

      it('does not touch the database', async () => {
        await service.register({ ...input, adultAttested: false }).catch(() => undefined);

        expect(db.create).not.toHaveBeenCalled();
      });
    });

    describe('when attested and the email is free', () => {
      const now = new Date('2026-10-01T12:00:00Z');
      const created = { id: 'athlete-1', isAdult: true };

      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        db.create.mockResolvedValue(created as never);
      });

      it('creates the athlete with server-side attestation and acceptance timestamps', async () => {
        await service.register({ ...input, adultAttested: true });

        expect(db.create).toHaveBeenCalledWith({
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          adultAttestedAt: now,
          tosAcceptedAt: now,
          tosVersion: CURRENT_TOS_VERSION,
        });
      });

      it('returns the created athlete', async () => {
        expect(await service.register({ ...input, adultAttested: true })).toEqual(created);
      });
    });

    describe('when the email is already registered', () => {
      beforeEach(() => {
        db.create.mockResolvedValue(null);
      });

      it('throws BadRequestException', async () => {
        await expect(service.register({ ...input, adultAttested: true })).rejects.toThrow(BadRequestException);
      });

      it('throws the email_already_registered code', async () => {
        await expect(service.register({ ...input, adultAttested: true })).rejects.toThrow(
          'email_already_registered',
        );
      });

      it('does not log the email', async () => {
        await service.register({ ...input, adultAttested: true }).catch(() => undefined);

        expect(JSON.stringify(warn.mock.calls)).not.toContain(input.email);
      });
    });
  });
});
