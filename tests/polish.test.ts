/**
 * Contract tests for the managed AI polish client — the status-code mapping must
 * mirror the Supabase edge function exactly (402 limit, 409 superseded → sign-out,
 * 503 maintenance, network failure → safe fallback).
 */
jest.mock('@/services/supabase', () => ({
  FUNCTIONS_URL: 'https://test.functions',
  SUPABASE_ANON_KEY: 'anon',
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { access_token: 'jwt-123' } },
      })),
    },
  },
}));

const signOutMock = jest.fn(async () => {});
jest.mock('@/services/auth', () => ({
  deviceId: jest.fn(async () => 'device-1'),
  signOut: () => signOutMock(),
}));

import { polish } from '@/services/polish';
import { supabase } from '@/services/supabase';

const mockFetch = (status: number, body: unknown) => {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
};

describe('polish()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns polished text + quota on success', async () => {
    mockFetch(200, { text: 'Polished.', remaining: 42, isPro: false });
    const r = await polish('raw text');
    expect(r).toEqual({ ok: true, text: 'Polished.', remaining: 42, isPro: false });
  });

  it('sends the backend contract payload', async () => {
    mockFetch(200, { text: 'x', remaining: 1, isPro: false });
    await polish('hello', 'email');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://test.functions/polish');
    expect(init.headers.Authorization).toBe('Bearer jwt-123');
    expect(init.headers.apikey).toBe('anon');
    expect(JSON.parse(init.body)).toEqual({
      text: 'hello',
      style: 'email',
      device_id: 'device-1',
      platform: 'mobile',
    });
  });

  it('maps 402 to limit_reached', async () => {
    mockFetch(402, { error: 'limit_reached', remaining: 0, isPro: false });
    const r = await polish('t');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('limit_reached');
    expect(r.remaining).toBe(0);
  });

  it('maps 409 to signed_out AND signs the user out (superseded device)', async () => {
    mockFetch(409, { error: 'device_superseded' });
    const r = await polish('t');
    expect(r.error).toBe('signed_out');
    expect(signOutMock).toHaveBeenCalled();
  });

  it('maps 503 to maintenance with the broadcast message', async () => {
    mockFetch(503, { error: 'maintenance', message: 'Back soon' });
    const r = await polish('t');
    expect(r.error).toBe('maintenance');
    expect(r.message).toBe('Back soon');
  });

  it('returns network error when fetch throws (server refunds the reservation)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const r = await polish('t');
    expect(r).toEqual({ ok: false, error: 'network' });
  });

  it('returns signed_out without calling fetch when there is no session', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: null } });
    global.fetch = jest.fn() as unknown as typeof fetch;
    const r = await polish('t');
    expect(r.error).toBe('signed_out');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
