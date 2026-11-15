import { IsEmail, MaxLength } from 'class-validator';

const EMAIL_MAX_LENGTH = 254;

export class CreateSetupIntentDto {
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}
