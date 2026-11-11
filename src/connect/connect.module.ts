import { Module } from '@nestjs/common';
import { AthletesModule } from '../athletes/athletes.module';
import { AuthModule } from '../auth/auth.module';
import { StripeModule } from '../stripe/stripe.module';
import { ConnectAccountUpdatedHandler } from './connect-account-updated.handler';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';

@Module({
  imports: [AthletesModule, AuthModule, StripeModule],
  controllers: [ConnectController],
  providers: [ConnectService, ConnectAccountUpdatedHandler],
})
export class ConnectModule {}
