import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { cents } from '../common/money';
import { BidService } from './bid.service';
import { AuctionBidParamsDto } from './dto/auction-bid-params.dto';
import { PlaceBidDto } from './dto/place-bid.dto';
import { toPlaceBidResponse, type PlaceBidResponse } from './place-bid-response';

const PLACE_BID_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auctions/:auctionId/bids')
export class BidController {
  constructor(private readonly service: BidService) {}

  @Post()
  @Throttle(PLACE_BID_LIMIT)
  async placeBid(
    @Param() params: AuctionBidParamsDto,
    @Body() body: PlaceBidDto,
    @Headers('x-bidder-token') bidderToken: string | undefined,
  ): Promise<PlaceBidResponse> {
    const result = await this.service.placeBid({
      auctionId: params.auctionId,
      bidderToken,
      amountCents: cents(body.amountCents),
    });

    return toPlaceBidResponse(result);
  }
}
