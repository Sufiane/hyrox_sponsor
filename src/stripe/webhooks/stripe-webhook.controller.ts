import { Controller, Headers, HttpCode, HttpStatus, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { WebhookChannel } from '../stripe-gateway';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('stripe/webhooks')
@SkipThrottle()
export class StripeWebhookController {
  constructor(private readonly service: StripeWebhookService) {}

  @Post('platform')
  @HttpCode(HttpStatus.OK)
  async platform(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<void> {
    await this.forward(request, signature, 'platform');
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  async connect(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<void> {
    await this.forward(request, signature, 'connect');
  }

  private async forward(
    request: RawBodyRequest<Request>,
    signature: string | undefined,
    channel: WebhookChannel,
  ): Promise<void> {
    await this.service.receive({ rawBody: request.rawBody, signature, channel });
  }
}
