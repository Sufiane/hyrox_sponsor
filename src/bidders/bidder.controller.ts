import { Body, Controller, Header, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BidderService } from './bidder.service';
import { CreateSetupIntentDto } from './dto/create-setup-intent.dto';
import { toSetupIntentResponse, type SetupIntentResponse } from './setup-intent-response';

const SETUP_INTENT_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('bidders')
export class BidderController {
  constructor(private readonly service: BidderService) {}

  @Post('setup-intents')
  @Throttle(SETUP_INTENT_LIMIT)
  @Header('Cache-Control', 'no-store')
  async createSetupIntent(
    @Body() body: CreateSetupIntentDto,
    @Headers('x-bidder-token') bidderToken: string | undefined,
  ): Promise<SetupIntentResponse> {
    const result = await this.service.createPaymentSetup({ email: body.email, bidderToken });

    return toSetupIntentResponse(result);
  }
}
