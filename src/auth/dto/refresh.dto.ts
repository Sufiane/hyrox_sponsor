import { IsString, Length } from 'class-validator';

export class RefreshDto {
  @IsString()
  @Length(1, 512)
  refreshToken!: string;
}
