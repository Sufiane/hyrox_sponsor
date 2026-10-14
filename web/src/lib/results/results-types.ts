export const DIVISION_CODES = [
  'SINGLE_OPEN_MEN',
  'SINGLE_OPEN_WOMEN',
  'SINGLE_PRO_MEN',
  'SINGLE_PRO_WOMEN',
  'DOUBLES_OPEN_MEN',
  'DOUBLES_OPEN_WOMEN',
  'DOUBLES_OPEN_MIXED',
  'DOUBLES_PRO_MEN',
  'DOUBLES_PRO_WOMEN',
  'RELAY_MEN',
  'RELAY_WOMEN',
  'RELAY_MIXED',
] as const;

export type DivisionCode = (typeof DIVISION_CODES)[number];

export type ResultStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type BibVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface PublicRaceListItem {
  id: string;
  name: string;
  location: string;
  date: string;
  timezone: string;
  resultCount: number;
  verifiedCount: number;
}

export interface PublicRaceList {
  items: PublicRaceListItem[];
  nextCursor: string | null;
}

export interface PublicDivisionSummary {
  division: DivisionCode;
  resultCount: number;
  verifiedCount: number;
}

export interface PublicRaceDetail {
  id: string;
  name: string;
  location: string;
  date: string;
  timezone: string;
  divisions: PublicDivisionSummary[];
}

export interface PublicResultItem {
  rank: number | null;
  displayName: string;
  finishTimeSeconds: number;
  verified: boolean;
}

export interface PublicResultPage {
  items: PublicResultItem[];
  total: number;
  verifiedTotal: number;
}

export interface SubmitResultResponse {
  raceEntryId: string;
  status: 'PENDING';
  submittedAt: string;
  publicVisible: boolean;
}

export interface OwnResult {
  status: ResultStatus;
  finishTimeSeconds: number;
  proofUrl: string | null;
  hasPhoto: boolean;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  publicVisible: boolean;
  bibVerificationStatus: BibVerificationStatus;
}

export interface OwnEntry {
  raceEntryId: string;
  raceName: string;
  raceDate: string;
  timezone: string;
  division: DivisionCode;
  bibVerificationStatus: BibVerificationStatus;
  resultStatus: ResultStatus | null;
}

export const RESULTS_PAGE_SIZE = 50;
export const MAX_RESULTS_OFFSET = 10_000;
export const MIN_FINISH_SECONDS = 1_800;
export const MAX_FINISH_SECONDS = 21_600;
export const MAX_PHOTO_BYTES = 10_485_760;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
