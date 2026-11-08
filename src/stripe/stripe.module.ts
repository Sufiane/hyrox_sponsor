import { Module } from '@nestjs/common';
import { StripeAdapter } from './stripe.adapter';
import { StripeGateway } from './stripe-gateway';
import { STRIPE_EVENT_HANDLERS } from './webhooks/stripe-event-handler';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';
import { StripeWebhookEventDb } from './webhooks/stripe-webhook-event.db';
import { StripeWebhookService } from './webhooks/stripe-webhook.service';

@Module({
  controllers: [StripeWebhookController],
  providers: [
    { provide: StripeGateway, useClass: StripeAdapter },
    { provide: STRIPE_EVENT_HANDLERS, useValue: [] },
    StripeWebhookService,
    StripeWebhookEventDb,
  ],
  exports: [StripeGateway],
})
export class StripeModule {}
