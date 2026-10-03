export abstract class DomainError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = new.target.name;
  }
}

export class InvalidValueError extends DomainError {}

export class NotFoundError extends DomainError {}

export class ForbiddenError extends DomainError {}

export class ConflictError extends DomainError {}
