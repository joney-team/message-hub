import { beforeEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@/server/config';
import { resetLimitersForTests } from '@/server/http/rate-limit';
import { STUDIO_SESSION_COOKIE } from '@/server/studio-auth';
import * as sessionRoute from '@/app/api/studio/session/route';
import * as passwordRoute from '@/app/api/studio/password/route';
import * as channelsRoute from '@/app/api/v1/channels/route';
import { insertChannel, useTestDb } from './helpers';

const API_KEY = 'k'.repeat(20);
const NEXT_PASSWORD = 'a-new-studio-password';
const ctx = { params: Promise.resolve({}) };

function jsonRequest(url: string, method: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toContain(`${STUDIO_SESSION_COOKIE}=`);
  return setCookie!.split(';', 1)[0];
}

describe('Studio password authentication', () => {
  beforeEach(() => {
    process.env.API_KEYS = `acme:${API_KEY},other:${'o'.repeat(20)}`;
    resetConfigForTests();
    resetLimitersForTests();
    useTestDb();
  });

  it('logs in with the default password and stores an HttpOnly session cookie', async () => {
    const login = await sessionRoute.POST(
      jsonRequest('http://hub.test/api/studio/session', 'POST', { password: 'messagehub@sayhi' }),
      ctx,
    );
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    expect(login.headers.get('set-cookie')).toContain('SameSite=Strict');

    const session = await sessionRoute.GET(
      new Request('http://hub.test/api/studio/session', { headers: { cookie: cookieFrom(login) } }),
      ctx,
    );
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ authenticated: true });
  });

  it('lets Studio manage every owner while API keys remain owner-scoped', async () => {
    insertChannel('acme', { name: 'Acme' });
    insertChannel('other', { name: 'Other' });

    const login = await sessionRoute.POST(
      jsonRequest('http://hub.test/api/studio/session', 'POST', { password: 'messagehub@sayhi' }),
      ctx,
    );
    const studioList = await channelsRoute.GET(
      new Request('http://hub.test/api/v1/channels?limit=100', { headers: { cookie: cookieFrom(login) } }),
      ctx,
    );
    expect((await studioList.json()).data.map((channel: { name: string }) => channel.name).sort()).toEqual(['Acme', 'Other']);

    const apiList = await channelsRoute.GET(
      new Request('http://hub.test/api/v1/channels?limit=100', {
        headers: { authorization: `Bearer ${API_KEY}` },
      }),
      ctx,
    );
    expect((await apiList.json()).data.map((channel: { name: string }) => channel.name)).toEqual(['Acme']);
  });

  it('changes the password, revokes old sessions and keeps the current browser signed in', async () => {
    const login = await sessionRoute.POST(
      jsonRequest('http://hub.test/api/studio/session', 'POST', { password: 'messagehub@sayhi' }),
      ctx,
    );
    const oldCookie = cookieFrom(login);
    const changed = await passwordRoute.PUT(
      jsonRequest(
        'http://hub.test/api/studio/password',
        'PUT',
        { currentPassword: 'messagehub@sayhi', newPassword: NEXT_PASSWORD },
        oldCookie,
      ),
      ctx,
    );
    expect(changed.status).toBe(200);
    const newCookie = cookieFrom(changed);

    expect(
      (
        await sessionRoute.GET(
          new Request('http://hub.test/api/studio/session', { headers: { cookie: oldCookie } }),
          ctx,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await sessionRoute.GET(
          new Request('http://hub.test/api/studio/session', { headers: { cookie: newCookie } }),
          ctx,
        )
      ).status,
    ).toBe(200);

    const oldPassword = await sessionRoute.POST(
      jsonRequest('http://hub.test/api/studio/session', 'POST', { password: 'messagehub@sayhi' }),
      ctx,
    );
    expect(oldPassword.status).toBe(401);
    const newPassword = await sessionRoute.POST(
      jsonRequest('http://hub.test/api/studio/session', 'POST', { password: NEXT_PASSWORD }),
      ctx,
    );
    expect(newPassword.status).toBe(200);
  });

  it('clears the session cookie on sign out', async () => {
    const login = await sessionRoute.POST(
      jsonRequest('http://hub.test/api/studio/session', 'POST', { password: 'messagehub@sayhi' }),
      ctx,
    );
    const cookie = cookieFrom(login);
    const logout = await sessionRoute.DELETE(
      new Request('http://hub.test/api/studio/session', { method: 'DELETE', headers: { cookie } }),
      ctx,
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(
      (
        await sessionRoute.GET(
          new Request('http://hub.test/api/studio/session', { headers: { cookie } }),
          ctx,
        )
      ).status,
    ).toBe(401);
  });
});
