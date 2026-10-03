import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError, InvalidValueError } from './domain-error';

type DomainErrorClass = abstract new (...args: never[]) => DomainError;

const STATUS_BY_ERROR: ReadonlyArray<readonly [DomainErrorClass, HttpStatus]> = [
  [InvalidValueError, HttpStatus.BAD_REQUEST],
];

const ERROR_LABEL_BY_STATUS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(exception: DomainError, host: ArgumentsHost): void {
    const status = this.statusFor(exception);

    this.logger.warn(`Domain error ${exception.code} -> ${status}`);

    host.switchToHttp().getResponse<Response>().status(status).json({
      statusCode: status,
      message: exception.code,
      error: ERROR_LABEL_BY_STATUS[status],
    });
  }

  private statusFor(exception: DomainError): HttpStatus {
    const match = STATUS_BY_ERROR.find(([errorClass]) => exception instanceof errorClass);

    return match ? match[1] : HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
