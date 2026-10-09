import { Logger } from '@nestjs/common';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const MIN_SECRET_LENGTH = 32;
const DEFAULT_ACCESS_TTL_SECONDS = 900;
const DEFAULT_REFRESH_TTL_SECONDS = 2_592_000;
const DEFAULT_STAFF_ACCESS_TTL_SECONDS = 900;
const DEFAULT_STAFF_REFRESH_TTL_SECONDS = 604_800;
const DEFAULT_PORT = 3000;
const MAX_PORT = 65_535;

export class EnvironmentVariables {
  @IsString()
  @Matches(/^postgres(ql)?:\/\//)
  DATABASE_URL!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PORT)
  PORT: number = DEFAULT_PORT;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin !== '')
      : value,
  )
  @IsString({ each: true })
  CORS_ORIGINS: string[] = [];

  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  JWT_SECRET!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  JWT_ACCESS_TTL_SECONDS: number = DEFAULT_ACCESS_TTL_SECONDS;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_SECONDS: number = DEFAULT_REFRESH_TTL_SECONDS;

  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  STAFF_JWT_SECRET!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  STAFF_JWT_TTL_SECONDS: number = DEFAULT_STAFF_ACCESS_TTL_SECONDS;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  STAFF_REFRESH_TOKEN_TTL_SECONDS: number = DEFAULT_STAFF_REFRESH_TTL_SECONDS;

  @IsString()
  @MinLength(1)
  STORAGE_REGION!: string;

  @IsString()
  @MinLength(1)
  STORAGE_BUCKET!: string;

  @IsString()
  @MinLength(1)
  STORAGE_ACCESS_KEY_ID!: string;

  @IsString()
  @MinLength(1)
  STORAGE_SECRET_ACCESS_KEY!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  STORAGE_ENDPOINT?: string;
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, raw);
  const errors = validateSync(env);

  if (errors.length > 0) {
    const invalid = errors.map((error) => error.property).join(', ');

    new Logger('Env').error(`Invalid environment variables: ${invalid}`);

    throw new Error('env_invalid');
  }

  if (env.STAFF_JWT_SECRET === env.JWT_SECRET) {
    new Logger('Env').error('staff_jwt_secret_must_differ_from_jwt_secret');

    throw new Error('env_invalid');
  }

  return env;
}
