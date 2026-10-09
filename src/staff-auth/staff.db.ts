import { Injectable } from '@nestjs/common';
import { Prisma, type StaffMember } from '@prisma/client';
import type { NormalizedEmail } from '../common/email';
import type { StaffId } from '../common/ids';
import type { PasswordHash } from '../common/password-hash';
import { RECORD_NOT_FOUND, UNIQUE_VIOLATION } from '../common/prisma-error-codes';
import { PrismaService } from '../prisma/prisma.service';

export type StaffRow = StaffMember & { id: StaffId; email: NormalizedEmail; passwordHash: PasswordHash };

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

@Injectable()
export class StaffDb {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: StaffId): Promise<StaffRow | null> {
    const row = await this.prisma.staffMember.findUnique({ where: { id } });

    return row as StaffRow | null;
  }

  async findByEmail(email: NormalizedEmail): Promise<StaffRow | null> {
    const row = await this.prisma.staffMember.findUnique({ where: { email } });

    return row as StaffRow | null;
  }

  async create(data: { name: string; email: NormalizedEmail; passwordHash: PasswordHash }): Promise<StaffRow | null> {
    try {
      const row = await this.prisma.staffMember.create({ data });

      return row as StaffRow;
    } catch (error) {
      if (hasCode(error, UNIQUE_VIOLATION)) {
        return null;
      }

      throw error;
    }
  }

  updatePassword(id: StaffId, passwordHash: PasswordHash, at: Date): Promise<StaffRow | null> {
    return this.updateAndRevoke(id, { passwordHash, tokensValidAfter: at }, at);
  }

  deactivate(id: StaffId, at: Date): Promise<StaffRow | null> {
    return this.updateAndRevoke(id, { isActive: false, tokensValidAfter: at }, at);
  }

  private async updateAndRevoke(
    id: StaffId,
    data: Prisma.StaffMemberUpdateInput,
    at: Date,
  ): Promise<StaffRow | null> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.staffMember.update({ where: { id }, data });

        await tx.staffRefreshToken.updateMany({
          where: { staffId: id, revokedAt: null },
          data: { revokedAt: at },
        });

        return updated;
      });

      return row as StaffRow;
    } catch (error) {
      if (hasCode(error, RECORD_NOT_FOUND)) {
        return null;
      }

      throw error;
    }
  }
}
