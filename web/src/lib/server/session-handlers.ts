import type { SignupInput } from '../auth/auth-types.ts';
import type { BackendAuth, BackendAuthPayload, BackendAuthResult } from './backend-auth.ts';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from './refresh-cookie.ts';
import type { CookieJar, RefreshCookieConfig } from './refresh-cookie.ts';

export interface SessionHandlersDeps extends RefreshCookieConfig {
  backend: BackendAuth;
}

export interface SessionHandlers {
  login(request: Request, jar: CookieJar): Promise<Response>;
  signup(request: Request, jar: CookieJar): Promise<Response>;
  refresh(jar: CookieJar): Promise<Response>;
  logout(jar: CookieJar): Promise<Response>;
}

function failure(status: number, code: string): Response {
  return Response.json({ statusCode: status, message: code }, { status });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();

    return typeof body === 'object' && body != null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseLogin(body: Record<string, unknown> | null): [string, string] | null {
  if (typeof body?.email !== 'string' || typeof body.password !== 'string') {
    return null;
  }

  return [body.email, body.password];
}

function parseSignup(body: Record<string, unknown> | null): SignupInput | null {
  if (
    typeof body?.name !== 'string' ||
    typeof body.email !== 'string' ||
    typeof body.password !== 'string' ||
    typeof body.adultAttested !== 'boolean'
  ) {
    return null;
  }

  return {
    name: body.name,
    email: body.email,
    password: body.password,
    adultAttested: body.adultAttested,
  };
}

export function createSessionHandlers(deps: SessionHandlersDeps): SessionHandlers {
  const cookieConfig: RefreshCookieConfig = {
    secure: deps.secure,
    maxAgeSeconds: deps.maxAgeSeconds,
  };

  function grantResponse(
    result: BackendAuthResult<BackendAuthPayload>,
    jar: CookieJar,
    okStatus: number,
  ): Response {
    if (!result.ok) {
      return failure(result.status, result.code);
    }

    writeRefreshToken(jar, result.value.refreshToken, cookieConfig);

    return Response.json(
      {
        accessToken: result.value.accessToken,
        expiresIn: result.value.expiresIn,
        athlete: result.value.athlete,
      },
      { status: okStatus },
    );
  }

  return {
    async login(request, jar): Promise<Response> {
      const credentials = parseLogin(await readBody(request));

      if (credentials == null) {
        return failure(400, 'validation_failed');
      }

      return grantResponse(await deps.backend.login(...credentials), jar, 200);
    },

    async signup(request, jar): Promise<Response> {
      const input = parseSignup(await readBody(request));

      if (input == null) {
        return failure(400, 'validation_failed');
      }

      return grantResponse(await deps.backend.signup(input), jar, 201);
    },

    async refresh(jar): Promise<Response> {
      const token = readRefreshToken(jar);

      if (token == null) {
        return failure(401, 'invalid_refresh_token');
      }

      const result = await deps.backend.refresh(token);

      if (!result.ok) {
        if (result.status === 401) {
          clearRefreshToken(jar);
        }

        return failure(result.status, result.code);
      }

      writeRefreshToken(jar, result.value.refreshToken, cookieConfig);

      return Response.json({
        accessToken: result.value.accessToken,
        expiresIn: result.value.expiresIn,
      });
    },

    async logout(jar): Promise<Response> {
      const token = readRefreshToken(jar);

      if (token != null) {
        await deps.backend.logout(token);
      }

      clearRefreshToken(jar);

      return new Response(null, { status: 204 });
    },
  };
}
