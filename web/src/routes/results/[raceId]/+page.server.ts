import { publicResultsApi } from '../../../lib/results/public-results-api.server.ts';
import { loadRacePage } from '../../../lib/results/results-loaders.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ fetch, params, url }) =>
  loadRacePage(publicResultsApi(fetch), params.raceId, url);
