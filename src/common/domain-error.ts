export abstract class DomainError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = new.target.name;
  }
}

export class InvalidValueError extends DomainError {}
