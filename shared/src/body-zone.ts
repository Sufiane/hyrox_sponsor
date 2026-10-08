export const BODY_ZONES = [
  'LEFT_PEC',
  'RIGHT_PEC',
  'UPPER_BACK',
  'LOWER_BACK',
  'LEFT_ARM',
  'RIGHT_ARM',
  'LEFT_THIGH',
  'RIGHT_THIGH',
  'ASS',
] as const;

export type BodyZone = (typeof BODY_ZONES)[number];
