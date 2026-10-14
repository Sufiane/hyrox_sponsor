import { publicResultsApi } from '../../lib/results/public-results-api.server.ts';
import { loadRaceList } from '../../lib/results/results-loaders.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ fetch, url }) => loadRaceList(publicResultsApi(fetch), url);
