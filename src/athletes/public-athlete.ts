import type { AthleteRecord } from './athlete.service';

export type PublicAthlete = {
  id: string;
  name: string;
  email: string;
  isAdult: boolean;
};

export function toPublicAthlete(athlete: AthleteRecord): PublicAthlete {
  return {
    id: athlete.id,
    name: athlete.name,
    email: athlete.email,
    isAdult: athlete.isAdult,
  };
}
