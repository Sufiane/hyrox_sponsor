import type { RequestHandler } from './$types';
import { resolveClientIp } from '../../../lib/server/client-ip.ts';
import { sessionHandlers } from '../../../lib/server/session-handlers.app.ts';

export const POST: RequestHandler = ({ request, cookies, getClientAddress }) =>
  sessionHandlers.signup(request, cookies, resolveClientIp(getClientAddress));
