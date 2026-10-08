import type { BodyZone } from './body-zone.ts';

export type BodyMapViewId = 'front' | 'back';

export interface BodyMapPoint {
  x: number;
  y: number;
}

export interface BodyMapRegion {
  zone: BodyZone;
  id: string;
  pathData: string;
  anchor: BodyMapPoint;
  hitPathData?: string;
}

export interface BodyMapView {
  id: BodyMapViewId;
  label: string;
  viewBox: string;
  silhouettePath: string;
  regions: BodyMapRegion[];
}

const VIEW_BOX = '0 0 200 480';

const SILHOUETTE_PATH = [
  'M100 12 L118 18 L124 36 L118 54 L100 60 L82 54 L76 36 L82 18 Z',
  'M90 58 L110 58 L110 76 L90 76 Z',
  'M58 74 L142 74 L142 284 L58 284 Z',
  'M20 80 L58 80 L58 206 L20 206 Z',
  'M142 80 L180 80 L180 206 L142 206 Z',
  'M60 280 L99 280 L97 470 L62 470 Z',
  'M101 280 L140 280 L138 470 L103 470 Z',
].join(' ');

const VIEWER_LEFT_ARM_HIT = 'M18 80 L61 80 L61 206 L18 206 Z';
const VIEWER_RIGHT_ARM_HIT = 'M139 80 L182 80 L182 206 L139 206 Z';
const VIEWER_LEFT_PEC_HIT = 'M62 80 L99.5 80 L99.5 142 L62 142 Z';
const VIEWER_RIGHT_PEC_HIT = 'M100.5 80 L138 80 L138 142 L100.5 142 Z';
const VIEWER_LEFT_THIGH_HIT = 'M60 286 L99.5 286 L99.5 382 L60 382 Z';
const VIEWER_RIGHT_THIGH_HIT = 'M100.5 286 L140 286 L140 382 L100.5 382 Z';

const VIEWER_LEFT_ARM_PATH = 'M24 86 L56 86 L56 200 L24 200 Z';
const VIEWER_RIGHT_ARM_PATH = 'M144 86 L176 86 L176 200 L144 200 Z';
const VIEWER_LEFT_THIGH_PATH = 'M64 290 L97 290 L97 376 L64 376 Z';
const VIEWER_RIGHT_THIGH_PATH = 'M103 290 L136 290 L136 376 L103 376 Z';

const VIEWER_LEFT_ARM_ANCHOR = { x: 40, y: 143 };
const VIEWER_RIGHT_ARM_ANCHOR = { x: 160, y: 143 };
const VIEWER_LEFT_THIGH_ANCHOR = { x: 80.5, y: 333 };
const VIEWER_RIGHT_THIGH_ANCHOR = { x: 119.5, y: 333 };

const FRONT_REGIONS: BodyMapRegion[] = [
  {
    zone: 'RIGHT_ARM',
    id: 'front-right-arm',
    pathData: VIEWER_LEFT_ARM_PATH,
    anchor: VIEWER_LEFT_ARM_ANCHOR,
    hitPathData: VIEWER_LEFT_ARM_HIT,
  },
  {
    zone: 'RIGHT_PEC',
    id: 'front-right-pec',
    pathData: 'M62 86 L98 86 L98 136 L62 136 Z',
    anchor: { x: 80, y: 111 },
    hitPathData: VIEWER_LEFT_PEC_HIT,
  },
  {
    zone: 'LEFT_PEC',
    id: 'front-left-pec',
    pathData: 'M102 86 L138 86 L138 136 L102 136 Z',
    anchor: { x: 120, y: 111 },
    hitPathData: VIEWER_RIGHT_PEC_HIT,
  },
  {
    zone: 'LEFT_ARM',
    id: 'front-left-arm',
    pathData: VIEWER_RIGHT_ARM_PATH,
    anchor: VIEWER_RIGHT_ARM_ANCHOR,
    hitPathData: VIEWER_RIGHT_ARM_HIT,
  },
  {
    zone: 'RIGHT_THIGH',
    id: 'front-right-thigh',
    pathData: VIEWER_LEFT_THIGH_PATH,
    anchor: VIEWER_LEFT_THIGH_ANCHOR,
    hitPathData: VIEWER_LEFT_THIGH_HIT,
  },
  {
    zone: 'LEFT_THIGH',
    id: 'front-left-thigh',
    pathData: VIEWER_RIGHT_THIGH_PATH,
    anchor: VIEWER_RIGHT_THIGH_ANCHOR,
    hitPathData: VIEWER_RIGHT_THIGH_HIT,
  },
];

const BACK_REGIONS: BodyMapRegion[] = [
  {
    zone: 'LEFT_ARM',
    id: 'back-left-arm',
    pathData: VIEWER_LEFT_ARM_PATH,
    anchor: VIEWER_LEFT_ARM_ANCHOR,
    hitPathData: VIEWER_LEFT_ARM_HIT,
  },
  {
    zone: 'UPPER_BACK',
    id: 'back-upper-back',
    pathData: 'M62 86 L138 86 L138 158 L62 158 Z',
    anchor: { x: 100, y: 122 },
  },
  {
    zone: 'RIGHT_ARM',
    id: 'back-right-arm',
    pathData: VIEWER_RIGHT_ARM_PATH,
    anchor: VIEWER_RIGHT_ARM_ANCHOR,
    hitPathData: VIEWER_RIGHT_ARM_HIT,
  },
  {
    zone: 'LOWER_BACK',
    id: 'back-lower-back',
    pathData: 'M62 164 L138 164 L138 220 L62 220 Z',
    anchor: { x: 100, y: 192 },
  },
  {
    zone: 'ASS',
    id: 'back-ass',
    pathData: 'M62 226 L138 226 L138 284 L62 284 Z',
    anchor: { x: 100, y: 255 },
  },
  {
    zone: 'LEFT_THIGH',
    id: 'back-left-thigh',
    pathData: VIEWER_LEFT_THIGH_PATH,
    anchor: VIEWER_LEFT_THIGH_ANCHOR,
    hitPathData: VIEWER_LEFT_THIGH_HIT,
  },
  {
    zone: 'RIGHT_THIGH',
    id: 'back-right-thigh',
    pathData: VIEWER_RIGHT_THIGH_PATH,
    anchor: VIEWER_RIGHT_THIGH_ANCHOR,
    hitPathData: VIEWER_RIGHT_THIGH_HIT,
  },
];

export const BODY_MAP_VIEWS: readonly BodyMapView[] = [
  {
    id: 'front',
    label: 'Front view',
    viewBox: VIEW_BOX,
    silhouettePath: SILHOUETTE_PATH,
    regions: FRONT_REGIONS,
  },
  {
    id: 'back',
    label: 'Back view',
    viewBox: VIEW_BOX,
    silhouettePath: SILHOUETTE_PATH,
    regions: BACK_REGIONS,
  },
];

export function regionsForZone(zone: BodyZone): BodyMapRegion[] {
  return BODY_MAP_VIEWS.flatMap((view) => view.regions).filter((region) => region.zone === zone);
}
