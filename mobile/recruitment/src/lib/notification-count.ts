export function badgeLabel(value: number): string | undefined {
  const count = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return count ? count > 99 ? '99+' : String(count) : undefined;
}
