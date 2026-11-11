import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InvalidValueError } from '../../common/domain-error';
import { StripeGateway, type StripeEvent, type WebhookChannel } from '../stripe-gateway';
import { StripeEventHandlerRegistry } from './stripe-event-handler-registry';
import { StripeWebhookEventDb } from './stripe-webhook-event.db';

const CLAIM_LEASE_MS = 60_000;

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly gateway: StripeGateway,
    private readonly db: StripeWebhookEventDb,
    private readonly registry: StripeEventHandlerRegistry,
  ) {}

  async receive(input: {
    rawBody: Buffer | undefined;
    signature: string | undefined;
    channel: WebhookChannel;
  }): Promise<void> {
    if (!input.rawBody || !input.signature) {
      this.logger.warn(`Webhook on ${input.channel} rejected: missing body or signature header`);

      throw new InvalidValueError('stripe_signature_invalid');
    }

    const event = this.gateway.constructWebhookEvent(input.rawBody, input.signature, input.channel);
    await this.db.insertIfNew({ id: event.id, type: event.type, channel: input.channel });

    const claimed = await this.db.claim(event.id, new Date(Date.now() - CLAIM_LEASE_MS));

    if (!claimed) {
      this.logger.debug(`Webhook ${event.id} (${event.type}) in flight or done`);

      return;
    }

    await this.dispatch(event);
    await this.db.markProcessed(event.id, new Date());
  }

  private async dispatch(event: StripeEvent): Promise<void> {
    const matching = this.registry.handlersFor(event.type);

    if (matching.length === 0) {
      this.logger.debug(`No handler for webhook ${event.id} (${event.type})`);

      return;
    }

    try {
      for (const handler of matching) {
        await handler.handle(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Handler failed for webhook ${event.id} (${event.type}): ${message}`);

      await this.db.release(event.id);

      throw new InternalServerErrorException('stripe_webhook_handler_failed');
    }
  }
}
