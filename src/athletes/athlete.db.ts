import { Injectable } from '@nestjs/common';
import type { AthleteId } from '../common/ids';
import type { NormalizedEmail } from '../common/email';
import type { PasswordHash } from '../common/password-hash';
import { Athlete, Prisma } from '@prisma/client';
import { UNIQUE_VIOLATION } from '../common/prisma-error-codes';
import { PrismaService } from '../prisma/prisma.service';

export type AthleteRow = Athlete & { id: AthleteId };
export type AthleteWithCredentials = AthleteRow & { passwordHash: PasswordHash };

@Injectable()
export class AthleteDb {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: AthleteId): Promise<AthleteRow | null> {
    const athlete = await this.prisma.athlete.findUnique({ where: { id } });

    return athlete as AthleteRow | null;
  }

  async findByEmail(email: NormalizedEmail): Promise<AthleteWithCredentials | null> {
    const athlete = await this.prisma.athlete.findUnique({ where: { email } });

    return athlete as AthleteWithCredentials | null;
  }

  async create(data: {
    name: string;
    email: NormalizedEmail;
    passwordHash: PasswordHash;
    adultAttestedAt: Date;
  }): Promise<AthleteRow | null> {
    try {
      const athlete = await this.prisma.athlete.create({ data: { ...data, isAdult: true } });

      return athlete as AthleteRow;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return null;
      }

      throw error;
    }
  }
}
