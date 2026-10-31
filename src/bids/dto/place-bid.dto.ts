import { IsEmail, IsInt, MaxLength, Min } from 'class-validator';

const EMAIL_MAX_LENGTH = 254;

export class PlaceBidDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsInt()
  @Min(1)
  amountCents!: number;
}
