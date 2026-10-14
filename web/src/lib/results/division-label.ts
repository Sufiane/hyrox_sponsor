const LABELS: Record<string, string> = {
  SINGLE_OPEN_MEN: 'Singles Open Men',
  SINGLE_OPEN_WOMEN: 'Singles Open Women',
  SINGLE_PRO_MEN: 'Singles Pro Men',
  SINGLE_PRO_WOMEN: 'Singles Pro Women',
  DOUBLES_OPEN_MEN: 'Doubles Open Men',
  DOUBLES_OPEN_WOMEN: 'Doubles Open Women',
  DOUBLES_OPEN_MIXED: 'Doubles Open Mixed',
  DOUBLES_PRO_MEN: 'Doubles Pro Men',
  DOUBLES_PRO_WOMEN: 'Doubles Pro Women',
  RELAY_MEN: 'Relay Men',
  RELAY_WOMEN: 'Relay Women',
  RELAY_MIXED: 'Relay Mixed',
};

export function divisionLabel(code: string): string {
  return LABELS[code] ?? code;
}
