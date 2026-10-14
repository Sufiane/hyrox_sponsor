import { InvalidValueError } from '../common/domain-error';
import { raceId, type RaceId } from '../common/ids';

export type RaceCursor = { date: Date; id: RaceId };

export function encodeRaceCursor(cursor: RaceCursor): string {
  return Buffer.from(JSON.stringify({ date: cursor.date.toISOString(), id: cursor.id })).toString('base64url');
}

export function decodeRaceCursor(raw: string): RaceCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { date?: unknown; id?: unknown };

    if (typeof parsed.date !== 'string' || typeof parsed.id !== 'string') {
      throw new InvalidValueError('cursor_invalid');
    }

    const date = new Date(parsed.date);

    if (Number.isNaN(date.getTime())) {
      throw new InvalidValueError('cursor_invalid');
    }

    return { date, id: raceId(parsed.id) };
  } catch {
    throw new InvalidValueError('cursor_invalid');
  }
}
