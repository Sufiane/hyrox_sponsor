import type { RequestHandler } from './$types';
import { sessionHandlers } from '../../../lib/server/session-handlers.app.ts';

export const POST: RequestHandler = ({ cookies }) => sessionHandlers.logout(cookies);
