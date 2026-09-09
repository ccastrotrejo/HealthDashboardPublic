import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import middleware from './middleware';

function request(authorization?: string): Request {
  return new Request('https://dashboard.example/data/snapshot.json', {
    headers: authorization == null ? {} : { authorization },
  });
}

describe('dashboard authentication', () => {
  beforeEach(() => {
    vi.stubEnv('DASHBOARD_USER', 'test-user');
    vi.stubEnv('DASHBOARD_PASS', 'test-password');
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['DASHBOARD_USER', 'DASHBOARD_PASS'])('fails closed when %s is missing', (key) => {
    vi.stubEnv(key, '');
    expect(middleware(request(`Basic ${btoa('test-user:test-password')}`)).status).toBe(503);
  });

  it.each([
    undefined, 'Bearer token', 'Basic !!!', `Basic ${btoa('test-user')}`,
    `Basic ${btoa('test-user:wrong')}`, `Basic ${btoa('wrong:test-password')}`,
    `Basic ${btoa('test-useR:test-password')}`, `Basic ${btoa('test-user:test-passworD')}`,
  ])('challenges missing, malformed, or incorrect credentials (%s)', (auth) => {
    const response = middleware(request(auth));
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe('Basic realm="Health Dashboard"');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('passes authenticated requests through the edge middleware', () => {
    const response = middleware(request(`Basic ${btoa('test-user:test-password')}`));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.has('WWW-Authenticate')).toBe(false);
  });

  it('allows colons in the password without splitting it into multiple fields', () => {
    vi.stubEnv('DASHBOARD_PASS', 'test:password:with:colons');
    expect(middleware(request(`Basic ${btoa('test-user:test:password:with:colons')}`))
      .headers.get('x-middleware-next')).toBe('1');
  });
});
