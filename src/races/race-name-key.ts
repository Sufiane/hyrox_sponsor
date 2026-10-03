export function raceNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}
