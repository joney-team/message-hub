import { beforeEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@/server/config';
import { clientIp, resetLimitersForTests } from '@/server/http/rate-limit';
import * as sessions from '@/app/api/widget/sessions/route';
import { insertChannel, useTestDb } from './helpers';

const req = (xff?: string) => new Request('http://hub.test/x', { headers: xff ? { 'x-forwarded-for': xff } : {} });

function configure(proxies?: string) {
  process.env.API_KEYS = `acme:${'a'.repeat(20)}`;
  if (proxies === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = proxies;
  resetConfigForTests();
}

async function create(channelId: string, xff?: string) {
  const r = await sessions.POST(
    new Request('http://hub.test/api/widget/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) },
      body: JSON.stringify({ channelId }),
    }),
    { params: Promise.resolve({}) },
  );
  return r.status;
}

beforeEach(() => {
  configure();
  resetLimitersForTests();
  useTestDb();
});

describe('clientIp', () => {
  it('takes the hop written by the trusted proxy (counted from the end), not what the client sent first', () => {
    expect(clientIp(req('6.6.6.6, 1.2.3.4'))).toBe('1.2.3.4');
    expect(clientIp(req('1.2.3.4'))).toBe('1.2.3.4');
  });

  it('counts N hops from the end with TRUSTED_PROXIES=N', () => {
    configure('2');
    expect(clientIp(req('6.6.6.6, 1.2.3.4, 10.0.0.1'))).toBe('1.2.3.4');
    expect(clientIp(req('1.2.3.4'))).toBeNull(); // fewer hops than proxies: header cannot be trusted
  });

  it('ignores the header completely with TRUSTED_PROXIES=0', () => {
    configure('0');
    expect(clientIp(req('1.2.3.4'))).toBeNull();
  });

  it('returns null for a missing or malformed address', () => {
    expect(clientIp(req())).toBeNull();
    expect(clientIp(req('<script>'))).toBeNull();
    expect(clientIp(req('1.2.3.4, '))).toBeNull();
  });

  it('accepts IPv6', () => {
    expect(clientIp(req('2001:db8::1'))).toBe('2001:db8::1');
  });
});

describe('session limit per IP', () => {
  it('cannot be bypassed by forging the first X-Forwarded-For hop', async () => {
    const ch = insertChannel();
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push(await create(ch.id, `10.9.9.${i}, 7.7.7.7`));
    expect(codes.filter((c) => c === 201)).toHaveLength(20);
    expect(codes.filter((c) => c === 429)).toHaveLength(5);
  });

  it('gives two real addresses their own limits', async () => {
    const ch = insertChannel();
    for (let i = 0; i < 20; i++) expect(await create(ch.id, '7.7.7.7')).toBe(201);
    expect(await create(ch.id, '7.7.7.7')).toBe(429);
    expect(await create(ch.id, '8.8.8.8')).toBe(201);
  });

  it('does not turn an unknown address into one shared limit that blocks everyone', async () => {
    const ch = insertChannel();
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push(await create(ch.id)); // no header at all
    expect(codes.every((c) => c === 201)).toBe(true);
  });

  it('with TRUSTED_PROXIES=0 forged headers change nothing and nobody is blocked per IP', async () => {
    configure('0');
    const ch = insertChannel();
    for (let i = 0; i < 30; i++) expect(await create(ch.id, `1.1.1.${i}`)).toBe(201);
  });

  it('still has a global backstop against floods from unknown addresses', async () => {
    const ch = insertChannel();
    const codes: number[] = [];
    for (let i = 0; i < 320; i++) codes.push(await create(ch.id));
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes.slice(0, 300).every((c) => c === 201)).toBe(true);
  });
});
