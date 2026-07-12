import { isAuthRateLimitScope, resolveRoute, stripApiPrefix } from './route-table';

describe('stripApiPrefix', () => {
  it('strips the prefix from a normal path', () => {
    expect(stripApiPrefix('/api/v1/leads/123', '/api/v1')).toBe('/leads/123');
  });

  it('reduces the bare prefix to "/"', () => {
    expect(stripApiPrefix('/api/v1', '/api/v1')).toBe('/');
  });

  it('reduces "/api/v1/" to "/"', () => {
    expect(stripApiPrefix('/api/v1/', '/api/v1')).toBe('/');
  });

  it('passes through unchanged when the prefix is absent (defensive fallback)', () => {
    expect(stripApiPrefix('/leads/123', '/api/v1')).toBe('/leads/123');
  });

  it('does not strip a path that merely starts with the prefix as a substring, not a segment', () => {
    // "/api/v1x/leads" must NOT become "x/leads" — /api/v1x is a different route entirely.
    expect(stripApiPrefix('/api/v1x/leads', '/api/v1')).toBe('/api/v1x/leads');
  });
});

describe('resolveRoute', () => {
  it.each([
    ['/auth/login', 'user'],
    ['/auth', 'user'],
    ['/users/me', 'user'],
    ['/leads', 'lead'],
    ['/leads/123/kyc', 'lead'],
    ['/ai/qa/ask', 'ai'],
    ['/ai/underwriting/run', 'ai'],
  ] as const)('routes %s to %s-service', (path, service) => {
    expect(resolveRoute(path)).toEqual({ kind: 'proxy', service });
  });

  it.each(['/dashboard', '/dashboard/me'])('routes %s locally', (path) => {
    expect(resolveRoute(path)).toEqual({ kind: 'local' });
  });

  it('routes /healthz locally', () => {
    expect(resolveRoute('/healthz')).toEqual({ kind: 'local' });
  });

  it('returns not-found for an unrecognized prefix', () => {
    expect(resolveRoute('/something-else')).toEqual({ kind: 'not-found' });
  });

  it('does not treat a lookalike prefix as a match ("/authentication" is not "/auth")', () => {
    expect(resolveRoute('/authentication')).toEqual({ kind: 'not-found' });
  });

  it('does not treat "/leadsomething" as "/leads"', () => {
    expect(resolveRoute('/leadsomething')).toEqual({ kind: 'not-found' });
  });
});

describe('isAuthRateLimitScope', () => {
  it('flags login and refresh', () => {
    expect(isAuthRateLimitScope('/auth/login')).toBe(true);
    expect(isAuthRateLimitScope('/auth/refresh')).toBe(true);
  });

  it('does not flag other auth routes (register should get the general quota, not the brute-force one)', () => {
    expect(isAuthRateLimitScope('/auth/register')).toBe(false);
    expect(isAuthRateLimitScope('/auth/logout')).toBe(false);
  });

  it('does not flag non-auth routes', () => {
    expect(isAuthRateLimitScope('/leads')).toBe(false);
  });
});
