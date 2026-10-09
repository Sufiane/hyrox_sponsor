import { InvalidValueError } from '../common/domain-error';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function assertPasswordLength(plain: string): void {
  if (plain.length < PASSWORD_MIN_LENGTH || plain.length > PASSWORD_MAX_LENGTH) {
    throw new InvalidValueError('password_length_invalid');
  }
}
