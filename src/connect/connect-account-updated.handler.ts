import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { StripeEvent } from '../stripe/stripe-gateway';
import { StripeEventHandler } from '../stripe/webhooks/stripe-event-handler';
import { StripeEventHandlerRegistry } from '../stripe/webhooks/stripe-event-handler-registry';
import { ConnectService } from './connect.service';

@Injectable()
export class ConnectAccountUpdatedHandler extends StripeEventHandler implements OnModuleInit {
  private readonly logger = new Logger(ConnectAccountUpdatedHandler.name);

  constructor(
    private readonly connect: ConnectService,
    private readonly registry: StripeEventHandlerRegistry,
  ) {
    super();
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  handles(type: string): boolean {
    return type === 'account.updated';
  }

  async handle(event: StripeEvent): Promise<void> {
    if (!event.accountId) {
      this.logger.debug(`Webhook ${event.id} (${event.type}) has no connected account id`);

      return;
    }

    await this.connect.syncReadiness(event.accountId);
  }
}
