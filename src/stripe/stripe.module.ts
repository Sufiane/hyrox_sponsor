import { Module } from '@nestjs/common';
import { StripeAdapter } from './stripe.adapter';
import { StripeGateway } from './stripe-gateway';
import { StripeEventHandlerRegistry } from './webhooks/stripe-event-handler-registry';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';
import { StripeWebhookEventDb } from './webhooks/stripe-webhook-event.db';
import { StripeWebhookService } from './webhooks/stripe-webhook.service';

@Module({
  controllers: [StripeWebhookController],
  providers: [
    { provide: StripeGateway, useClass: StripeAdapter },
    StripeEventHandlerRegistry,
    StripeWebhookService,
    StripeWebhookEventDb,
  ],
  exports: [StripeGateway, StripeEventHandlerRegistry],
})
export class StripeModule {}
