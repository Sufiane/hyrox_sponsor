import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { normalizeEmail } from '../common/email';
import type { BidderId } from '../common/ids';
import { BidderDb } from './bidder.db';
import {
  CreatePaymentSetupUsecase,
  type CreatePaymentSetupInput,
  type CreatePaymentSetupResult,
} from './usecases/create-payment-setup/create-payment-setup.usecase';
import {
  SyncPaymentMethodUsecase,
  type SyncPaymentMethodCommand,
  type SyncPaymentMethodOutcome,
} from './usecases/sync-payment-method/sync-payment-method.usecase';

type BidderRecord = Awaited<ReturnType<BidderDb['upsertByEmail']>>;

@Injectable()
export class BidderService {
  private readonly logger = new Logger(BidderService.name);

  constructor(
    private readonly db: BidderDb,
    private readonly createPaymentSetupUsecase: CreatePaymentSetupUsecase,
    private readonly syncPaymentMethodUsecase: SyncPaymentMethodUsecase,
  ) {}

  createPaymentSetup(input: CreatePaymentSetupInput): Promise<CreatePaymentSetupResult> {
    return this.createPaymentSetupUsecase.execute(input);
  }

  syncPaymentMethod(command: SyncPaymentMethodCommand): Promise<SyncPaymentMethodOutcome> {
    return this.syncPaymentMethodUsecase.execute(command);
  }

  async getOrCreateByEmail(rawEmail: string): Promise<BidderRecord> {
    return this.db.upsertByEmail(normalizeEmail(rawEmail));
  }

  async getById(id: BidderId): Promise<BidderRecord> {
    const bidder = await this.db.findById(id);

    if (!bidder) {
      this.throwNotFound(id);
    }

    return bidder;
  }

  private throwNotFound(id: BidderId): never {
    this.logger.warn(`Bidder ${id} not found`);

    throw new NotFoundException('bidder_not_found');
  }
}
