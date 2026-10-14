import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DIVISION, type RaceDivisionCode } from '../../races/race-division';

export const DEFAULT_RESULTS_LIMIT = 50;
export const MAX_RESULTS_LIMIT = 100;
export const MAX_RESULTS_OFFSET = 10_000;

export class ListResultsQueryDto {
  @IsIn(Object.values(DIVISION))
  division!: RaceDivisionCode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RESULTS_LIMIT)
  limit: number = DEFAULT_RESULTS_LIMIT;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_RESULTS_OFFSET)
  offset: number = 0;
}
