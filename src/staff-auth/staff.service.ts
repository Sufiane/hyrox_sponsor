import { Injectable, Logger } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../common/domain-error';
import type { NormalizedEmail } from '../common/email';
import type { StaffId } from '../common/ids';
import type { PasswordHash } from '../common/password-hash';
import { StaffDb, type StaffRow } from './staff.db';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(private readonly db: StaffDb) {}

  async findActiveById(id: StaffId): Promise<StaffRow | null> {
    const row = await this.db.findById(id);

    if (!row || !row.isActive) {
      return null;
    }

    return row;
  }

  findByEmail(email: NormalizedEmail): Promise<StaffRow | null> {
    return this.db.findByEmail(email);
  }

  async create(input: { name: string; email: NormalizedEmail; passwordHash: PasswordHash }): Promise<StaffRow> {
    const row = await this.db.create(input);

    if (!row) {
      this.logger.warn(`Staff creation refused: email ${input.email} already taken`);

      throw new ConflictError('staff_email_taken');
    }

    return row;
  }

  async setPassword(email: NormalizedEmail, passwordHash: PasswordHash): Promise<void> {
    const staff = await this.getByEmail(email);
    const updated = await this.db.updatePassword(staff.id, passwordHash, new Date());

    if (!updated) {
      this.logger.warn(`Password change failed: staff ${staff.id} vanished`);

      throw new NotFoundError('staff_not_found');
    }
  }

  async deactivate(email: NormalizedEmail): Promise<void> {
    const staff = await this.getByEmail(email);
    const updated = await this.db.deactivate(staff.id, new Date());

    if (!updated) {
      this.logger.warn(`Deactivation failed: staff ${staff.id} vanished`);

      throw new NotFoundError('staff_not_found');
    }
  }

  private async getByEmail(email: NormalizedEmail): Promise<StaffRow> {
    const staff = await this.db.findByEmail(email);

    if (!staff) {
      this.logger.warn(`Staff lookup failed: no staff with email ${email}`);

      throw new NotFoundError('staff_not_found');
    }

    return staff;
  }
}
