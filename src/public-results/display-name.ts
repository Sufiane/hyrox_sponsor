const FALLBACK_NAME = 'Athlete';

function initialOf(token: string): string {
  return Array.from(token)[0].toLocaleUpperCase();
}

export function displayName(fullName: string): string {
  const tokens = fullName.split(/\s+/).filter((token) => token !== '');

  if (tokens.length === 0) {
    return FALLBACK_NAME;
  }

  if (tokens.length === 1) {
    return tokens[0];
  }

  return `${tokens[0]} ${initialOf(tokens[tokens.length - 1])}.`;
}
