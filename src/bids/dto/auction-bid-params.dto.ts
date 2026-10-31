import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { auctionId, type AuctionId } from '../../common/ids';

export class AuctionBidParamsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? auctionId(value) : value))
  @IsString()
  auctionId!: AuctionId;
}
