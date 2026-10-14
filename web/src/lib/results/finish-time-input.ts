import { MAX_FINISH_SECONDS, MIN_FINISH_SECONDS } from './results-types.ts';

export interface FinishTimeParts {
  hours: string;
  minutes: string;
  seconds: string;
}

export type FinishTimeResult = { ok: true; value: number } | { ok: false; error: string };

const MAX_HOURS = 6;
const MAX_MINUTES_OR_SECONDS = 59;
const WHOLE_NUMBER = /^\d{1,2}$/;

function parsePart(raw: string, max: number): number | null {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return 0;
  }

  if (!WHOLE_NUMBER.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);

  return value > max ? null : value;
}

export function toTotalSeconds(parts: FinishTimeParts): FinishTimeResult {
  const hours = parsePart(parts.hours, MAX_HOURS);
  const minutes = parsePart(parts.minutes, MAX_MINUTES_OR_SECONDS);
  const seconds = parsePart(parts.seconds, MAX_MINUTES_OR_SECONDS);

  if (hours == null || minutes == null || seconds == null) {
    return {
      ok: false,
      error: 'Enter whole numbers: hours 0 to 6, minutes and seconds 0 to 59.',
    };
  }

  const total = hours * 3_600 + minutes * 60 + seconds;

  if (total < MIN_FINISH_SECONDS || total > MAX_FINISH_SECONDS) {
    return { ok: false, error: 'Finish time must be between 0:30:00 and 6:00:00.' };
  }

  return { ok: true, value: total };
}
