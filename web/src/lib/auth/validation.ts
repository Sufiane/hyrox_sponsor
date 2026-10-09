const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 100;
const SIGNUP_PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;

export type FieldErrors = Record<string, string>;

export interface LoginFormInput {
  email: string;
  password: string;
}

export interface SignupFormInput {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  adultAttested: boolean;
}

function emailError(email: string): string | null {
  return EMAIL_SHAPE.test(email.trim()) ? null : 'Enter a valid email address.';
}

function nameError(name: string): string | null {
  const trimmed = name.trim();

  if (trimmed === '') {
    return 'Enter your name.';
  }

  return trimmed.length > NAME_MAX ? `Name must be ${NAME_MAX} characters or fewer.` : null;
}

function passwordError(password: string): string | null {
  if (password.length < SIGNUP_PASSWORD_MIN) {
    return `Password must be at least ${SIGNUP_PASSWORD_MIN} characters.`;
  }

  return password.length > PASSWORD_MAX
    ? `Password must be ${PASSWORD_MAX} characters or fewer.`
    : null;
}

function collect(entries: [string, string | null][]): FieldErrors {
  const errors: FieldErrors = {};

  for (const [field, message] of entries) {
    if (message != null) {
      errors[field] = message;
    }
  }

  return errors;
}

export function validateLogin(input: LoginFormInput): FieldErrors {
  return collect([
    ['email', emailError(input.email)],
    ['password', input.password === '' ? 'Enter your password.' : null],
  ]);
}

export function validateSignup(input: SignupFormInput): FieldErrors {
  return collect([
    ['name', nameError(input.name)],
    ['email', emailError(input.email)],
    ['password', passwordError(input.password)],
    [
      'confirmPassword',
      input.confirmPassword === input.password ? null : 'Passwords do not match.',
    ],
    ['adultAttested', input.adultAttested ? null : 'You must confirm you are 18 or older.'],
  ]);
}
