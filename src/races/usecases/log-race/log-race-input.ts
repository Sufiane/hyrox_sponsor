import type { IanaTimezone } from '../../../common/iana-timezone';
import type { RaceDivisionCode } from '../../race-division';

export interface LogRaceInput {
  name: string;
  location: string;
  date: Date;
  timezone: IanaTimezone;
  division: RaceDivisionCode;
}
