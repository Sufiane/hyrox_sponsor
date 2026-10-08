import { IsIn } from 'class-validator';
import { ZONE_ORDER, type BodyZoneValue } from '../zone-order';

export class ZoneParamDto {
  @IsIn(ZONE_ORDER)
  zone!: BodyZoneValue;
}
