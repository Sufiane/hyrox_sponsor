import type { BodyZone } from '@prisma/client';

export type BodyZoneValue = BodyZone;

export const ZONE_ORDER = [
  'LEFT_PEC',
  'RIGHT_PEC',
  'UPPER_BACK',
  'LOWER_BACK',
  'LEFT_ARM',
  'RIGHT_ARM',
  'LEFT_THIGH',
  'RIGHT_THIGH',
  'ASS',
] as const satisfies readonly BodyZoneValue[];

type AssertNever<T extends never> = T;

export type EveryZoneListed = AssertNever<Exclude<BodyZoneValue, (typeof ZONE_ORDER)[number]>>;
