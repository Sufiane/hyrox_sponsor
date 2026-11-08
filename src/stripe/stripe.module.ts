import { Module } from '@nestjs/common';
import { StripeAdapter } from './stripe.adapter';
import { StripeGateway } from './stripe-gateway';

@Module({
  providers: [{ provide: StripeGateway, useClass: StripeAdapter }],
  exports: [StripeGateway],
})
export class StripeModule {}
