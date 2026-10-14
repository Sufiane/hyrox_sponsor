import { error } from '@sveltejs/kit';
import type { ApiResult } from './api-result.ts';
import type { ResultsApi } from './results-api.ts';
import { MAX_RESULTS_OFFSET, RESULTS_PAGE_SIZE } from './results-types.ts';
import type { PublicRaceDetail, PublicRaceList, PublicResultPage } from './results-types.ts';

export interface RaceListData {
  races: PublicRaceList['items'];
  nextCursor: string | null;
}

export interface RacePageData {
  race: PublicRaceDetail;
  division: string | null;
  page: number;
  results: PublicResultPage | null;
}

const MAX_PAGE = Math.floor(MAX_RESULTS_OFFSET / RESULTS_PAGE_SIZE) + 1;
const WHOLE_NUMBER = /^\d{1,6}$/;

function unwrap<T>(result: ApiResult<T>): T {
  if (result.ok) {
    return result.value;
  }

  if (result.status === 404 || result.status === 400) {
    error(404, 'Not found');
  }

  error(502, 'Results are unavailable right now');
}

export function parsePage(raw: string | null): number {
  if (raw == null || !WHOLE_NUMBER.test(raw)) {
    return 1;
  }

  return Math.min(Math.max(Number(raw), 1), MAX_PAGE);
}

export function pickDivision(raw: string | null, race: PublicRaceDetail): string | null {
  const known = race.divisions.find((entry) => entry.division === raw);

  if (known != null) {
    return known.division;
  }

  return race.divisions[0]?.division ?? null;
}

export async function loadRaceList(api: ResultsApi, url: URL): Promise<RaceListData> {
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const list = unwrap(await api.listRaces(cursor));

  return { races: list.items, nextCursor: list.nextCursor };
}

export async function loadRacePage(
  api: ResultsApi,
  raceId: string,
  url: URL,
): Promise<RacePageData> {
  const race = unwrap(await api.getRace(raceId));
  const division = pickDivision(url.searchParams.get('division'), race);
  const page = parsePage(url.searchParams.get('page'));

  if (division == null) {
    return { race, division, page, results: null };
  }

  const results = unwrap(await api.listResults(raceId, { division, page }));

  return { race, division, page, results };
}
