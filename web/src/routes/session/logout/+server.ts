import type { RequestHandler } from './$types';
import { resolveClientIp } from '../../../lib/server/client-ip.ts';
import { sessionHandlers } from '../../../lib/server/session-handlers.app.ts';

export const POST: RequestHandler = ({ cookies, getClientAddress }) =>
  sessionHandlers.logout(cookies, resolveClientIp(getClientAddress));
