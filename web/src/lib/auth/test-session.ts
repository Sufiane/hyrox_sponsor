import type { Mock } from 'vitest';
import type { Session, SessionStatus } from './session.svelte.ts';
import type { SessionAthlete } from './auth-types.ts';

export interface FakeSession extends Session {
  login: Mock<Session['login']>;
  signup: Mock<Session['signup']>;
  logout: Mock<Session['logout']>;
  status: SessionStatus;
}

export function createFakeSession(status: SessionStatus = 'anonymous'): FakeSession {
  return {
    status,
    athlete: null as SessionAthlete | null,
    bootstrap: vi.fn<Session['bootstrap']>(),
    login: vi.fn<Session['login']>().mockResolvedValue(undefined),
    signup: vi.fn<Session['signup']>().mockResolvedValue(undefined),
    logout: vi.fn<Session['logout']>().mockResolvedValue(undefined),
    refresh: vi.fn<Session['refresh']>(),
    getAccessToken: () => null,
    isExpiringSoon: () => true,
  };
}
