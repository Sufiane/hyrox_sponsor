import type { Brand } from './brand';

export type TosVersion = Brand<string, 'TosVersion'>;

export const CURRENT_TOS_VERSION = '2026-10-10-draft' as TosVersion;
