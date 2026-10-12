import type { IanaTimezone } from '../common/iana-timezone';
import { instantAtLocalMidnight } from '../common/zoned-time';

export const OPEN_DAYS_BEFORE_RACE = 12;
export const CLOSE_DAYS_BEFORE_RACE = 5;
export const PROOF_WINDOW_HOURS = 48;

const MILLIS_PER_HOUR = 3_600_000;
const MILLIS_PER_DAY = 86_400_000;

export type AuctionWindow = { openAt: Date; closeAt: Date };

function daysBefore(localDate: Date, days: number): Date {
  return new Date(localDate.getTime() - days * MILLIS_PER_DAY);
}

export function auctionWindow(raceLocalDate: Date, timezone: IanaTimezone): AuctionWindow {
  return {
    openAt: instantAtLocalMidnight(daysBefore(raceLocalDate, OPEN_DAYS_BEFORE_RACE), timezone),
    closeAt: instantAtLocalMidnight(daysBefore(raceLocalDate, CLOSE_DAYS_BEFORE_RACE), timezone),
  };
}

export function proofDeadline(raceDate: Date): Date {
  return new Date(raceDate.getTime() + PROOF_WINDOW_HOURS * MILLIS_PER_HOUR);
}
