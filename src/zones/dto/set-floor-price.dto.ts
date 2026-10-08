import { IsNumber } from 'class-validator';

export class SetFloorPriceDto {
  @IsNumber()
  floorPriceCents!: number;
}
