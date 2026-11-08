import { Injectable } from '@nestjs/common';
import { Prisma, type StripeWebhookChannel } from '@prisma/client';
import { UNIQUE_VIOLATION } from '../../common/prisma-error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import type { WebhookChannel } from '../stripe-gateway';

const CHANNEL_TO_ENUM: Record<WebhookChannel, StripeWebhookChannel> = {
  platform: 'PLATFORM',
  connect: 'CONNECT',
};

@Injectable()
export class StripeWebhookEventDb {
  constructor(private readonly prisma: PrismaService) {}

  async insertIfNew(input: { id: string; type: string; channel: WebhookChannel }): Promise<boolean> {
    try {
      await this.prisma.stripeWebhookEvent.create({
        data: { id: input.id, type: input.type, channel: CHANNEL_TO_ENUM[input.channel] },
      });

      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return false;
      }

      throw error;
    }
  }

  async claim(id: string, staleBefore: Date): Promise<boolean> {
    const result = await this.prisma.stripeWebhookEvent.updateMany({
      where: { id, processedAt: null, OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] },
      data: { claimedAt: new Date() },
    });

    return result.count > 0;
  }

  async release(id: string): Promise<void> {
    await this.prisma.stripeWebhookEvent.updateMany({ where: { id, processedAt: null }, data: { claimedAt: null } });
  }

  async markProcessed(id: string, processedAt: Date): Promise<void> {
    await this.prisma.stripeWebhookEvent.updateMany({ where: { id }, data: { processedAt } });
  }
}
