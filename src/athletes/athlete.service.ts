import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AthleteId } from '../common/ids';
import type { NormalizedEmail } from '../common/email';
import type { PasswordHash } from '../common/password-hash';
import { CURRENT_TOS_VERSION, type TosVersion } from '../common/tos-version';
import { AthleteDb, type AthleteWithCredentials } from './athlete.db';

export type AthleteRecord = NonNullable<Awaited<ReturnType<AthleteDb['findById']>>>;

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

  findByEmail(email: NormalizedEmail): Promise<AthleteWithCredentials | null> {
    return this.db.findByEmail(email);
  }

  assertAdultAttested(adultAttested: boolean | undefined): void {
    if (adultAttested !== true) {
      this.logger.warn('Signup rejected: 18+ attestation missing');

      throw new BadRequestException('adult_attestation_required');
    }
  }

  assertTosAccepted(tosVersion: string | undefined): TosVersion {
    if (tosVersion === undefined) {
      this.logger.warn('Signup rejected: ToS acceptance missing');

      throw new BadRequestException('tos_acceptance_required');
    }

    if (tosVersion !== CURRENT_TOS_VERSION) {
      this.logger.warn(
        `Signup rejected: ToS version ${tosVersion} is not current ${CURRENT_TOS_VERSION}`,
      );

      throw new BadRequestException('tos_version_mismatch');
    }

    return CURRENT_TOS_VERSION;
  }

  async register(input: {
    name: string;
    email: NormalizedEmail;
    passwordHash: PasswordHash;
    adultAttested: boolean | undefined;
    tosVersion: TosVersion;
  }): Promise<AthleteRecord> {
    this.assertAdultAttested(input.adultAttested);

    const now = new Date();
    const athlete = await this.db.create({
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      adultAttestedAt: now,
      tosAcceptedAt: now,
      tosVersion: input.tosVersion,
    });

    if (!athlete) {
      this.logger.warn('Signup rejected: email already registered');

      throw new BadRequestException('email_already_registered');
    }

    return athlete;
  }
}
