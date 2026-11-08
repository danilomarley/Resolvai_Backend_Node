import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { authRoutes } from '../src/api/routes/auth-routes.js';
import { registrarTratamentoDeErros } from '../src/api/problem-details.js';
import { AuthService } from '../src/application/services/auth-service.js';
import { SupabaseAuthClient } from '../src/infrastructure/security/supabase-auth-client.js';
import { FakeSupabase, FakeUsers } from './fakes.js';

const origin = 'http://localhost:5173';
const redirectTo = `${origin}/redefinir-senha`;

async function setup() {
  const auth = new FakeSupabase();
  const users = new FakeUsers();
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarTratamentoDeErros(app);
  await app.register(authRoutes(new AuthService(users, auth), async () => ({ isAuthenticated: false }), users, [origin]));
  return { app, auth };
}

describe('password recovery email endpoint', () => {
  it('requests real delivery for any valid email and returns a uniform response without a login', async () => {
    const { app, auth } = await setup();
    try {
      const send = (email: string) => app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email, redirectTo } });
      const existing = await send('EXISTENTE@example.com');
      const missing = await send('ausente@example.com');
      expect(existing.statusCode).toBe(200);
      expect(missing.statusCode).toBe(200);
      expect(existing.json()).toEqual(missing.json());
      expect(existing.headers['cache-control']).toBe('no-store');
      expect(auth.recuperacoes).toEqual([{ email: 'existente@example.com', redirectTo }, { email: 'ausente@example.com', redirectTo }]);
      expect(auth.senhasAlteradas).toHaveLength(0);
    } finally { await app.close(); }
  });

  it.each(['https://evil.invalid/redefinir-senha', `${origin}/login`, `${redirectTo}?next=https://evil.invalid`, `${redirectTo}#token`, 'javascript:alert(1)', 'http://user:password@localhost:5173/redefinir-senha'])(
    'rejects an unapproved redirect without calling Auth: %s', async redirect => {
      const { app, auth } = await setup();
      try {
        const result = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'test@example.com', redirectTo: redirect } });
        expect(result.statusCode).toBe(400);
        expect(auth.recuperacoes).toHaveLength(0);
      } finally { await app.close(); }
    }
  );

  it('limits the same email across IPs and limits each IP before sending email', async () => {
    const { app, auth } = await setup();
    try {
      const send = (email: string, ip = '203.0.113.1') => app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', remoteAddress: ip, payload: { email, redirectTo } });
      expect((await send('test@example.com')).statusCode).toBe(200);
      expect((await send('TEST@example.com', '203.0.113.2')).statusCode).toBe(429);
      for (let i = 0; i < 9; i++) expect((await send(`test${i}@example.com`)).statusCode).toBe(200);
      expect((await send('blocked@example.com')).statusCode).toBe(429);
      expect(auth.recuperacoes).toHaveLength(10);
    } finally { await app.close(); }
  });
});

describe('Supabase recovery HTTP boundary', () => {
  const options = { url: 'https://auth.invalid', anonKey: 'public-test', serviceRoleKey: 'server-only' };
  it('uses the public key and the encoded redirect_to parameter with POST /recover', async () => {
    const client = new SupabaseAuthClient(options, (async (url, init) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe('/auth/v1/recover');
      expect(parsed.searchParams.get('redirect_to')).toBe(redirectTo);
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ email: 'test@example.com' });
      expect(init?.headers).toMatchObject({ apikey: 'public-test', Authorization: 'Bearer public-test' });
      return Response.json({});
    }) as typeof fetch);
    await client.requestPasswordRecovery('test@example.com', redirectTo);
  });

  it.each([400, 404, 422])('does not reveal missing users for upstream status %s', async status => {
    const client = new SupabaseAuthClient(options, (async () => Response.json({ error_code: 'user_not_found' }, { status })) as typeof fetch);
    await expect(client.requestPasswordRecovery('missing@example.com', redirectTo)).resolves.toBeUndefined();
  });

  it.each([429, 500, 401, 422])('surfaces delivery failures instead of reporting success: %s', async status => {
    const client = new SupabaseAuthClient(options, (async () => Response.json({ error_code: 'delivery_failed' }, { status })) as typeof fetch);
    await expect(client.requestPasswordRecovery('test@example.com', redirectTo)).rejects.toMatchObject({ name: status === 429 ? 'MuitasTentativasException' : 'ServicoIndisponivelException' });
  });
});
