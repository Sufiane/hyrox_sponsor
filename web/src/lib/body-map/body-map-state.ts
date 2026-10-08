import { regionsForZone } from '@hyrox-sponsor/shared/body-map-geometry';
import { BODY_ZONE_LABELS } from '@hyrox-sponsor/shared/body-zone-labels';
import type { BodyZone } from '@hyrox-sponsor/shared/body-zone';

export interface ZoneState {
  badge?: string;
  disabled?: boolean;
}

export type ZoneStates = Partial<Record<BodyZone, ZoneState>>;

interface InteractivityOptions {
  disabled?: boolean;
  zoneStates?: ZoneStates;
}

export function isZoneInteractive(zone: BodyZone, options: InteractivityOptions): boolean {
  return options.disabled !== true && options.zoneStates?.[zone]?.disabled !== true;
}

export function nextSelection(
  current: BodyZone | null,
  chosen: BodyZone,
  options: InteractivityOptions,
): BodyZone | null {
  if (!isZoneInteractive(chosen, options)) {
    return current;
  }

  return chosen;
}

export function regionAccessibleName(
  zone: BodyZone,
  viewLabel: string,
  zoneState: ZoneState | undefined,
): string {
  const base = `${BODY_ZONE_LABELS[zone]}, ${viewLabel.toLowerCase()}`;

  if (zoneState?.badge == null || zoneState.badge === '') {
    return base;
  }

  return `${base}, ${zoneState.badge}`;
}

export function zoneCaption(zone: BodyZone): string | null {
  if (regionsForZone(zone).length < 2) {
    return null;
  }

  return `${BODY_ZONE_LABELS[zone]} (front + back)`;
}
