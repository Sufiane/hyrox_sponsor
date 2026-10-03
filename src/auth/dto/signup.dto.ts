import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class SignupDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(10, 128)
  password!: string;

  @IsOptional()
  @IsBoolean()
  adultAttested?: boolean;
}
