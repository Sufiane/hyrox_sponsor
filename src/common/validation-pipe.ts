import { BadRequestException, Logger, ValidationPipe, type ValidationError } from '@nestjs/common';

const logger = new Logger('Validation');

function describeErrors(errors: ValidationError[]): string {
  return errors
    .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
    .join('; ');
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]): BadRequestException => {
      logger.warn(`Request validation failed: ${describeErrors(errors)}`);

      return new BadRequestException('validation_failed');
    },
  });
}
