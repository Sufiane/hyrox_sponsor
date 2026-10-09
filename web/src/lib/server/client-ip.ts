export function resolveClientIp(getClientAddress: () => string): string | null {
  try {
    const address = getClientAddress().trim();

    return address === '' ? null : address;
  } catch {
    return null;
  }
}
