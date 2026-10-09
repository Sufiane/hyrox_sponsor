export interface SessionAthlete {
  id: string;
  name: string;
  email: string;
  isAdult: boolean;
}

export interface AccessGrant {
  accessToken: string;
  expiresIn: number;
}

export interface AuthGrant extends AccessGrant {
  athlete: SessionAthlete;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  adultAttested: boolean;
}

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'AuthApiError';
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super('not_authenticated');
    this.name = 'NotAuthenticatedError';
  }
}
