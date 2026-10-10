/** Compare deux versions `MAJEUR.MINEUR.CORRECTIF` ; négatif si `a` est plus ancienne. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Sans version minimale connue, l'application n'est jamais bloquée. */
export function isUpdateRequired(current: string, minimum: string | null | undefined): boolean {
  return typeof minimum === 'string' && minimum.length > 0 && compareVersions(current, minimum) < 0;
}
