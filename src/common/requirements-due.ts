export function parseRequirementsDue(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (!value.every((entry) => typeof entry === 'string')) {
    return null;
  }

  return value as string[];
}
