import { FEATURE_KEYS, parseEnv } from '@/config/env';

describe('parseEnv', () => {
  it('retombe sur la configuration la plus stricte sans données de build', () => {
    const env = parseEnv(undefined);
    expect(env.variant).toBe('production');
    expect(env.apiUrl).toBeNull();
    for (const key of FEATURE_KEYS) expect(env.features[key]).toBe(false);
  });

  it('accepte une URL HTTPS et retire le slash final', () => {
    expect(parseEnv({ variant: 'production', apiUrl: 'https://atlas.example.test/' }).apiUrl).toBe(
      'https://atlas.example.test',
    );
  });

  it('refuse HTTP hors développement', () => {
    expect(parseEnv({ variant: 'production', apiUrl: 'http://atlas.example.test' }).apiUrl).toBeNull();
    expect(parseEnv({ variant: 'staging', apiUrl: 'http://atlas.example.test' }).apiUrl).toBeNull();
    expect(parseEnv({ variant: 'development', apiUrl: 'http://192.168.1.20:8000' }).apiUrl).toBe(
      'http://192.168.1.20:8000',
    );
  });

  it('refuse une URL portant des identifiants ou un schéma inattendu', () => {
    expect(parseEnv({ variant: 'production', apiUrl: 'https://user:pass@atlas.example.test' }).apiUrl).toBeNull();
    expect(parseEnv({ variant: 'development', apiUrl: 'ftp://atlas.example.test' }).apiUrl).toBeNull();
    expect(parseEnv({ variant: 'development', apiUrl: 42 }).apiUrl).toBeNull();
  });

  it('traite une variante inconnue comme la production', () => {
    expect(parseEnv({ variant: 'qa' }).variant).toBe('production');
  });

  it("n'active une fonction que sur un booléen true explicite", () => {
    const env = parseEnv({ variant: 'staging', features: { biometrics: true, gps: 'true', push: 1 } });
    expect(env.features.biometrics).toBe(true);
    expect(env.features.gps).toBe(false);
    expect(env.features.push).toBe(false);
    expect(env.features.offline).toBe(false);
  });

  it('borne le délai de verrouillage et retombe sur 2 minutes', () => {
    expect(parseEnv({}).lockTimeoutMs).toBe(120_000);
    expect(parseEnv({ lockTimeoutSeconds: 300 }).lockTimeoutMs).toBe(300_000);
    for (const invalid of [0, 5, 99_999, '300', 12.5, null]) {
      expect(parseEnv({ lockTimeoutSeconds: invalid }).lockTimeoutMs).toBe(120_000);
    }
  });

  it("n'accepte que de vraies fiches store pour la mise à jour", () => {
    expect(parseEnv({}).storeUrls).toEqual({ ios: null, android: null });
    expect(
      parseEnv({ storeUrls: { ios: 'https://apps.apple.com/app/id1', android: 'https://evil.example/apk' } }).storeUrls,
    ).toEqual({ ios: 'https://apps.apple.com/app/id1', android: null });
  });
});
