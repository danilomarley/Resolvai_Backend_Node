import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SupabaseAuthClient } from '../src/infrastructure/security/supabase-auth-client.js';

const options = { url: 'https://auth.invalid', anonKey: 'public-test', serviceRoleKey: 'server-test' };
const email = 'sintetico@teste.com';
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

describe('Supabase Auth HTTP boundary', () => {
  it('nao adota UUID ofuscado: retoma somente com senha verificada', async () => {
    const realId = randomUUID();
    const chamadas: string[] = [];
    const client = new SupabaseAuthClient(options, (async (url, init) => {
      chamadas.push(String(url));
      if (String(url).endsWith('/signup')) return response({ id: randomUUID(), email, identities: [] });
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ email, password: 'SenhaTeste123' });
      return response({ access_token: 'access', refresh_token: 'refresh', user: { id: realId, email } });
    }) as typeof fetch);
    expect((await client.signUp(email, 'SenhaTeste123', 'Sintético')).id).toBe(realId);
    expect(chamadas).toHaveLength(2);
  });

  it('identifica criacao nova por identities e nonce devolvido', async () => {
    const id = randomUUID();
    const client = new SupabaseAuthClient(options, (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.data.registration_attempt).toEqual(expect.any(String));
      return response({ id, email, identities: [{ id: randomUUID() }], user_metadata: body.data });
    }) as typeof fetch);
    expect(await client.signUp(email, 'SenhaTeste123', 'Sintético')).toEqual({ id, email });
  });

  it('conta existente com senha incorreta nao cria nem redefine identidade', async () => {
    const client = new SupabaseAuthClient(options, (async url => {
      if (String(url).endsWith('/signup')) return response({ error_code: 'user_already_exists' }, 422);
      return response({ error: 'invalid_grant' }, 400);
    }) as typeof fetch);
    await expect(client.signUp(email, 'SenhaErrada123', 'Sintético')).rejects.toThrow('Confirme seu e-mail');
  });

  it('nao trata erro de senha fraca como conta existente', async () => {
    const client = new SupabaseAuthClient(options, (async () => response({ error_code: 'weak_password' }, 422)) as typeof fetch);
    await expect(client.signUp(email, 'SenhaTeste123', 'Sintético')).rejects.toMatchObject({ name: 'DomainException' });
  });

  it('refresh envia somente refresh_token e devolve a sessao rotacionada', async () => {
    const id = randomUUID();
    const client = new SupabaseAuthClient(options, (async (url, init) => {
      expect(String(url)).toBe('https://auth.invalid/auth/v1/token?grant_type=refresh_token');
      expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'old-refresh' });
      expect((init?.headers as Record<string, string>).apikey).toBe('public-test');
      return response({ access_token: 'new-access', refresh_token: 'new-refresh', user: { id, email }, expires_in: 3600 });
    }) as typeof fetch);
    expect(await client.refreshSession('old-refresh')).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', user: { id, email } });
  });

  it('falha de transporte devolve erro de disponibilidade sem dados do transporte', async () => {
    const client = new SupabaseAuthClient(options, (async () => { throw new TypeError('detalhe privado do transporte'); }) as typeof fetch);
    await expect(client.refreshSession('old-refresh')).rejects.toMatchObject({ name: 'ServicoIndisponivelException' });
  });
});
