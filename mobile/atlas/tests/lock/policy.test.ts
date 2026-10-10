import { shouldLockOnForeground } from '@/lock/policy';
import { compareVersions, isUpdateRequired } from '@/update/version';

describe('shouldLockOnForeground', () => {
  const base = { enabled: true, backgroundedAt: 1_000_000, timeoutMs: 120_000 };

  it('ne verrouille jamais si la fonction est désactivée ou sans passage en arrière-plan', () => {
    expect(shouldLockOnForeground({ ...base, enabled: false, now: 9_000_000 })).toBe(false);
    expect(shouldLockOnForeground({ ...base, backgroundedAt: null, now: 9_000_000 })).toBe(false);
  });

  it('verrouille une fois le délai atteint, pas avant', () => {
    expect(shouldLockOnForeground({ ...base, now: 1_000_000 + 119_999 })).toBe(false);
    expect(shouldLockOnForeground({ ...base, now: 1_000_000 + 120_000 })).toBe(true);
    expect(shouldLockOnForeground({ ...base, now: 1_000_000 + 3_600_000 })).toBe(true);
  });

  it("verrouille si l'horloge a reculé pendant l'absence", () => {
    expect(shouldLockOnForeground({ ...base, now: 999_000 })).toBe(true);
  });
});

describe('versions', () => {
  it('compare des versions semver', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.9', '1.0.10')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it("n'exige une mise à jour que sous une version minimale connue", () => {
    expect(isUpdateRequired('1.0.0', '1.1.0')).toBe(true);
    expect(isUpdateRequired('1.1.0', '1.1.0')).toBe(false);
    expect(isUpdateRequired('1.0.0', null)).toBe(false);
    expect(isUpdateRequired('1.0.0', undefined)).toBe(false);
    expect(isUpdateRequired('1.0.0', '')).toBe(false);
  });
});
