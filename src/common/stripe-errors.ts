import { DomainError } from './domain-error';

export class StripeUnavailableError extends DomainError {
  constructor() {
    super('stripe_unavailable');
  }
}

export class StripeMisconfiguredError extends DomainError {
  constructor() {
    super('stripe_misconfigured');
  }
}

export class StripeRejectedError extends DomainError {
  constructor() {
    super('stripe_request_rejected');
  }
}
