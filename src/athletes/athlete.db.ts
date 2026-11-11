import { Injectable } from '@nestjs/common';
import type { AthleteId } from '../common/ids';
import type { NormalizedEmail } from '../common/email';
import type { PasswordHash } from '../common/password-hash';
import type { StripeConnectAccountId } from '../common/stripe-ids';
import type { TosVersion } from '../common/tos-version';
import { Athlete, Prisma } from '@prisma/client';
import { parseRequirementsDue } from '../common/requirements-due';
import { RECORD_NOT_FOUND, UNIQUE_VIOLATION } from '../common/prisma-error-codes';
import { PrismaService } from '../prisma/prisma.service';

export type AthleteRow = Athlete & {
  id: AthleteId;
  stripeConnectAccountId: StripeConnectAccountId | null;
  stripeConnectRequirementsDue: string[] | null;
};
export type AthleteWithCredentials = AthleteRow & { passwordHash: PasswordHash };

@Injectable()
export class AthleteDb {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: AthleteId): Promise<AthleteRow | null> {
    const athlete = await this.prisma.athlete.findUnique({ where: { id } });

    return this.toRow(athlete) as AthleteRow | null;
  }

  async findByEmail(email: NormalizedEmail): Promise<AthleteWithCredentials | null> {
    const athlete = await this.prisma.athlete.findUnique({ where: { email } });

    return this.toRow(athlete) as AthleteWithCredentials | null;
  }

  async create(data: {
    name: string;
    email: NormalizedEmail;
    passwordHash: PasswordHash;
    adultAttestedAt: Date;
    tosAcceptedAt: Date;
    tosVersion: TosVersion;
  }): Promise<AthleteRow | null> {
    try {
      const athlete = await this.prisma.athlete.create({ data: { ...data, isAdult: true } });

      return this.toRow(athlete) as AthleteRow;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return null;
      }

      throw error;
    }
  }

  async setStripeConnectAccountIdIfUnset(id: AthleteId, accountId: StripeConnectAccountId): Promise<AthleteRow | null> {
    try {
      const result = await this.prisma.athlete.updateMany({
        where: { id, stripeConnectAccountId: null },
        data: { stripeConnectAccountId: accountId },
      });

      if (result.count === 0) {
        return null;
      }

      return await this.findById(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return null;
      }

      throw error;
    }
  }

  async findByStripeConnectAccountId(accountId: StripeConnectAccountId): Promise<AthleteRow | null> {
    const athlete = await this.prisma.athlete.findUnique({ where: { stripeConnectAccountId: accountId } });

    return this.toRow(athlete) as AthleteRow | null;
  }

  async updateConnectReadiness(
    id: AthleteId,
    readiness: {
      detailsSubmitted: boolean;
      payoutsEnabled: boolean;
      requirementsDue: readonly string[];
      syncedAt: Date;
    },
  ): Promise<boolean> {
    const result = await this.prisma.athlete.updateMany({
      where: {
        id,
        OR: [{ stripeConnectSyncedAt: null }, { stripeConnectSyncedAt: { lt: readiness.syncedAt } }],
      },
      data: {
        stripeConnectDetailsSubmitted: readiness.detailsSubmitted,
        stripeConnectPayoutsEnabled: readiness.payoutsEnabled,
        stripeConnectRequirementsDue: [...readiness.requirementsDue],
        stripeConnectSyncedAt: readiness.syncedAt,
      },
    });

    return result.count > 0;
  }

  private toRow(athlete: Athlete | null): (Athlete & { stripeConnectRequirementsDue: string[] | null }) | null {
    if (athlete == null) {
      return null;
    }

    return { ...athlete, stripeConnectRequirementsDue: parseRequirementsDue(athlete.stripeConnectRequirementsDue) };
  }
}
