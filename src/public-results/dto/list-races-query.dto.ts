import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_RACES_LIMIT = 20;
export const MAX_RACES_LIMIT = 50;
const CURSOR_MAX_LENGTH = 200;

export class ListRacesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_RACES_LIMIT)
  limit: number = DEFAULT_RACES_LIMIT;

  @IsOptional()
  @IsString()
  @MaxLength(CURSOR_MAX_LENGTH)
  cursor?: string;
}
