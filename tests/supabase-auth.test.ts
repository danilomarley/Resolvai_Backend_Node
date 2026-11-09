import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registrarTratamentoDeErros } from '../src/api/problem-details.js';
import { FornecedorService } from '../src/application/services/fornecedor-service.js';
import { SupabaseAuthClient } from '../src/infrastructure/security/supabase-auth-client.js';
import { FakeEspecialidades, FakeFornecedores, FakeUsers } from './fakes.js';

const options = { url: 'https://auth.invalid', anonKey: 'public-test', serviceRoleKey: 'server-test' };
const email = 'sintetico@teste.com';
const passwordA = 'SenhaOriginalA123';
const passwordB = 'SenhaTentativaB123';
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
type ExternalAccount = { id: string; email: string; password: string; confirmed: boolean };

/** Stateful boundary models GoTrue: public signup replaces pending passwords;
 * admin create rejects duplicates; login requires the original password and confirmation. */
class ExternalAuth {
  account?: ExternalAccount;
  settings: unknown = { disable_signup: false, external: { email: true }, mailer_autoconfirm: false };
  settingsStatus = 200;
  resendStatus = 200;
  createError?: { error_code: string; status: number };
  createOutcome?: 'lost' | 'server-error' | 'malformed' | 'wrong-email';
  raceAccount?: ExternalAccount;
  successfulLogins = 0;
  confirmationEmails = 0;
  creates = 0;
  publicSignups = 0;
  destructiveWrites = 0;
  readonly calls: { path: string; method: string; body: Record<string, unknown>; key: string | undefined }[] = [];

  pending(): ExternalAccount {
    return this.account = { id: randomUUID(), email, password: passwordA, confirmed: false };
  }

  readonly fetcher = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const parsed = new URL(String(url));
    const path = parsed.pathname + parsed.search;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const key = (init?.headers as Record<string, string> | undefined)?.apikey;
    this.calls.push({ path, method, body, key });
    if (method === 'PUT' || method === 'DELETE') { this.destructiveWrites++; return response({}, 500); }
    if (path === '/auth/v1/settings') {
      expect(method).toBe('GET');
      expect(init?.body).toBeUndefined();
      return response(this.settings as object, this.settingsStatus);
    }
    if (path === '/auth/v1/signup') {
      this.publicSignups++;
      const policy = this.settings as { disable_signup?: boolean; external?: { email?: boolean }; mailer_autoconfirm?: boolean };
      if (policy.disable_signup || policy.external?.email === false) return response({ error_code: 'signup_disabled' }, 422);
      if (this.account?.confirmed) return response({ id: randomUUID(), email, identities: [], user_metadata: body.data });
      if (!this.account) this.account = { id: randomUUID(), email, password: String(body.password), confirmed: false };
      this.account.password = String(body.password);
      if (policy.mailer_autoconfirm === true) this.account.confirmed = true;
      return response({ id: this.account!.id, email, identities: [{ id: randomUUID() }], user_metadata: body.data });
    }
    if (path === '/auth/v1/admin/users') {
      expect(method).toBe('POST');
      expect(key).toBe(options.serviceRoleKey);
      if (this.raceAccount) { this.account = this.raceAccount; this.raceAccount = undefined; }
      if (this.account) return response({ error_code: 'email_exists', id: randomUUID(), email }, 422);
      if (this.createError) return response({ error_code: this.createError.error_code }, this.createError.status);
      this.account = { id: randomUUID(), email: String(body.email), password: String(body.password), confirmed: body.email_confirm === true };
      this.creates++;
      const outcome = this.createOutcome;
      this.createOutcome = undefined;
      if (outcome === 'lost') throw new TypeError('response lost after external commit');
      if (outcome === 'server-error') return response({ error_code: 'unexpected_failure' }, 500);
      if (outcome === 'malformed') return response({ email });
      if (outcome === 'wrong-email') return response({ id: randomUUID(), email: 'unrelated@example.com' });
      return response({ id: this.account.id, email: this.account.email, email_confirmed_at: this.account.confirmed ? new Date().toISOString() : null });
    }
    if (path === '/auth/v1/token?grant_type=password') {
      expect(key).toBe(options.anonKey);
      if (!this.account || body.password !== this.account.password) return response({ error_code: 'invalid_credentials' }, 400);
      if (!this.account.confirmed) return response({ error_code: 'email_not_confirmed' }, 400);
      this.successfulLogins++;
      return response({ access_token: 'access', refresh_token: 'refresh', user: { id: this.account.id, email: this.account.email }, expires_in: 3600 });
    }
    if (path === '/auth/v1/resend') {
      expect(key).toBe(options.anonKey);
      expect(body).toEqual({ type: 'signup', email });
      if (this.resendStatus === 200 && this.account && !this.account.confirmed) this.confirmationEmails++;
      return response({}, this.resendStatus);
    }
    throw new Error(`Unexpected Auth request ${method} ${path}`);
  }) as typeof fetch;
}

describe('Supabase registration preserves external accounts', () => {
  it.each([401, 403])('Auth admin refusal %s returns service configuration failure without creating a provider', async status => {
    const external = new ExternalAuth();
    external.createError = { error_code: 'not_admin', status };
    const users = new FakeUsers();
    const profiles = new FakeFornecedores();
    const service = new FornecedorService(users, profiles, new FakeEspecialidades(), new SupabaseAuthClient(options, external.fetcher));
    const app = Fastify();
    registrarTratamentoDeErros(app);
    app.post('/api/v1/auth/register-provider', () => service.register({
      name: 'Sintético', email, password: passwordA, tipoPessoa: 'PF', nomeExibicao: 'Sintético',
      cpf: '52998224725', telefone: '85999991234', cidadeAtuacao: 'Fortaleza', ufAtuacao: 'CE',
      raioAtendimentoKm: 20, especialidades: ['eletrica']
    }));
    try {
      const result = await app.inject({ method: 'POST', url: '/api/v1/auth/register-provider' });
      expect(result.statusCode).toBe(503);
      expect(result.json()).toMatchObject({ code: 'AUTH_CONFIGURATION_ERROR', status: 503 });
      expect(result.json().detail).toMatch(/configuração do serviço/);
      expect(external.account).toBeUndefined();
      expect(users.users.size).toBe(0);
      expect(profiles.profiles.size).toBe(0);
      expect(external.calls.map(call => call.path)).toEqual(['/auth/v1/settings', '/auth/v1/admin/users']);
    } finally {
      await app.close();
    }
  });

  it.each([false, true])('pending password A survives retry B, including autoconfirm=%s', async autoconfirm => {
    const external = new ExternalAuth();
    external.settings = { disable_signup: false, external: { email: true }, mailer_autoconfirm: autoconfirm };
    const original = external.pending();
    const client = new SupabaseAuthClient(options, external.fetcher);
    const result = await client.signUp(email, passwordB, 'Sintético').then(user => ({ user, error: undefined }), error => ({ user: undefined, error }));
    expect(external.account?.password).toBe(passwordA);
    expect(external.account?.confirmed).toBe(false);
    expect(result.user).toBeUndefined();
    expect(result.error).toMatchObject({ name: 'ConflictException' });
    expect(external.successfulLogins).toBe(0);
    await expect(client.signUp(email, passwordA, 'Sintético')).rejects.toMatchObject({ name: 'ConflictException' });
    external.account!.confirmed = true;
    expect(await client.signUp(email, passwordA, 'Sintético')).toEqual({ id: original.id, email });
    expect(external.successfulLogins).toBe(1);
    expect(external.publicSignups).toBe(0);
    expect(external.destructiveWrites).toBe(0);
  });

  it.each([false, true])('new registration follows project autoconfirm=%s', async autoconfirm => {
    const external = new ExternalAuth();
    external.settings = { disable_signup: false, external: { email: true }, mailer_autoconfirm: autoconfirm };
    const created = await new SupabaseAuthClient(options, external.fetcher).signUp(email, passwordA, 'Sintético');
    expect(created).toEqual({ id: external.account!.id, email });
    expect(external.account).toMatchObject({ password: passwordA, confirmed: autoconfirm });
    expect(external.confirmationEmails).toBe(autoconfirm ? 0 : 1);
    expect(external.creates).toBe(1);
    expect(external.calls[0]?.path).toBe('/auth/v1/settings');
    expect(external.calls.find(call => call.path === '/auth/v1/admin/users')?.body).toEqual({
      email, password: passwordA, email_confirm: autoconfirm, user_metadata: { name: 'Sintético' }
    });
    expect(external.publicSignups).toBe(0);
  });

  it('confirmed retry requires the existing password instead of adopting a duplicate UUID', async () => {
    const external = new ExternalAuth();
    const original = external.pending();
    original.confirmed = true;
    const client = new SupabaseAuthClient(options, external.fetcher);
    await expect(client.signUp(email, passwordB, 'Sintético')).rejects.toMatchObject({ name: 'ConflictException' });
    expect(await client.signUp(email, passwordA, 'Sintético')).toEqual({ id: original.id, email });
    expect(external.account!.password).toBe(passwordA);
    expect(external.successfulLogins).toBe(1);
    expect(external.creates).toBe(0);
  });

  it.each([
    { disable_signup: true, external: { email: true }, mailer_autoconfirm: true },
    { disable_signup: false, external: { email: false }, mailer_autoconfirm: true }
  ])('disabled project policy prevents privileged registration: %j', async settings => {
    const external = new ExternalAuth();
    external.settings = settings;
    await expect(new SupabaseAuthClient(options, external.fetcher).signUp(email, passwordA, 'Sintético')).rejects.toMatchObject({ name: 'ForbiddenException' });
    expect(external.account).toBeUndefined();
    expect(external.calls).toHaveLength(1);
  });

  it.each([{}, { disable_signup: false, external: { email: true } }, { disable_signup: false, external: { email: true }, mailer_autoconfirm: 'false' }])(
    'missing or malformed settings fail closed: %j', async settings => {
      const external = new ExternalAuth();
      external.settings = settings;
      await expect(new SupabaseAuthClient(options, external.fetcher).signUp(email, passwordA, 'Sintético')).rejects.toMatchObject({ name: 'ServicoIndisponivelException' });
      expect(external.account).toBeUndefined();
      expect(external.calls).toHaveLength(1);
    }
  );

  it('settings HTTP failure does not create or auto-confirm an account', async () => {
    const external = new ExternalAuth();
    external.settingsStatus = 500;
    await expect(new SupabaseAuthClient(options, external.fetcher).signUp(email, passwordA, 'Sintético')).rejects.toMatchObject({ name: 'ServicoIndisponivelException' });
    expect(external.account).toBeUndefined();
    expect(external.calls).toHaveLength(1);
  });

  it('failed confirmation delivery remains visible and recoverable without password reset', async () => {
    const external = new ExternalAuth();
    external.resendStatus = 500;
    const client = new SupabaseAuthClient(options, external.fetcher);
    await expect(client.signUp(email, passwordA, 'Sintético')).rejects.toMatchObject({ name: 'ServicoIndisponivelException' });
    expect(external.account).toMatchObject({ password: passwordA, confirmed: false });
    external.resendStatus = 200;
    await expect(client.signUp(email, passwordB, 'Sintético')).rejects.toMatchObject({ name: 'ConflictException' });
    expect(external.account!.password).toBe(passwordA);
    expect(external.confirmationEmails).toBe(1);
    external.account!.confirmed = true;
    expect((await client.signUp(email, passwordA, 'Sintético')).id).toBe(external.account!.id);
  });

  it('a create race cannot replace another account password or adopt its UUID', async () => {
    const external = new ExternalAuth();
    const original = { id: randomUUID(), email, password: passwordA, confirmed: true };
    external.raceAccount = original;
    const client = new SupabaseAuthClient(options, external.fetcher);
    await expect(client.signUp(email, passwordB, 'Sintético')).rejects.toMatchObject({ name: 'ConflictException' });
    expect(external.account).toEqual(original);
    expect(external.successfulLogins).toBe(0);
    expect(await client.signUp(email, passwordA, 'Sintético')).toEqual({ id: original.id, email });
  });

  it.each(['lost', 'server-error', 'malformed', 'wrong-email'] as const)(
    'unknown create outcome %s resumes only after successful password authentication', async outcome => {
      const external = new ExternalAuth();
      external.createOutcome = outcome;
      const client = new SupabaseAuthClient(options, external.fetcher);
      await expect(client.signUp(email, passwordA, 'Sintético')).rejects.toMatchObject({ name: 'ServicoIndisponivelException' });
      expect(external.account).toMatchObject({ password: passwordA, confirmed: false });
      expect(external.successfulLogins).toBe(0);
      await expect(client.signUp(email, passwordB, 'Sintético')).rejects.toMatchObject({ name: 'ConflictException' });
      expect(external.account!.password).toBe(passwordA);
      external.account!.confirmed = true;
      expect((await client.signUp(email, passwordA, 'Sintético')).id).toBe(external.account!.id);
      expect(external.successfulLogins).toBe(1);
      expect(external.creates).toBe(1);
      expect(external.publicSignups).toBe(0);
    }
  );

  it('lost response after autoconfirm creation is recovered by authenticated UUID', async () => {
    const external = new ExternalAuth();
    external.settings = { disable_signup: false, external: { email: true }, mailer_autoconfirm: true };
    external.createOutcome = 'lost';
    const created = await new SupabaseAuthClient(options, external.fetcher).signUp(email, passwordA, 'Sintético');
    expect(created).toEqual({ id: external.account!.id, email });
    expect(external.successfulLogins).toBe(1);
  });

  it('weak-password or other 422 rejection never masquerades as a duplicate', async () => {
    for (const error_code of ['weak_password', 'validation_failed']) {
      const external = new ExternalAuth();
      external.createError = { error_code, status: 422 };
      await expect(new SupabaseAuthClient(options, external.fetcher).signUp(email, passwordA, 'Sintético')).rejects.toMatchObject({ name: 'DomainException' });
      expect(external.account).toBeUndefined();
      expect(external.calls.map(call => call.path)).toEqual(['/auth/v1/settings', '/auth/v1/admin/users']);
    }
  });

  it('provider never persists an unowned pending external identity on wrong-password retry', async () => {
    const external = new ExternalAuth();
    external.pending();
    const users = new FakeUsers();
    const profiles = new FakeFornecedores();
    const service = new FornecedorService(users, profiles, new FakeEspecialidades(), new SupabaseAuthClient(options, external.fetcher));
    const result = await service.register({ name: 'Sintético', email, password: passwordB, tipoPessoa: 'PF', nomeExibicao: 'Sintético',
      cpf: '52998224725', telefone: '85999991234', cidadeAtuacao: 'Fortaleza', ufAtuacao: 'CE', raioAtendimentoKm: 20,
      especialidades: ['eletrica'] }).then(user => ({ user, error: undefined }), error => ({ user: undefined, error }));
    expect(external.account!.password).toBe(passwordA);
    expect(result.user).toBeUndefined();
    expect(result.error).toMatchObject({ name: 'ConflictException' });
    expect(users.users.size).toBe(0);
    expect(profiles.profiles.size).toBe(0);
  });

  it('administrative provisioning still creates confirmed users independently of registration policy', async () => {
    const external = new ExternalAuth();
    external.settings = { disable_signup: true, external: { email: false }, mailer_autoconfirm: false };
    const created = await new SupabaseAuthClient(options, external.fetcher).adminCreateUser(email, passwordA, 'Admin Provisionado');
    expect(created.id).toBe(external.account!.id);
    expect(external.account!.confirmed).toBe(true);
    expect(external.calls.map(call => call.path)).toEqual(['/auth/v1/admin/users']);
  });
});

describe('Supabase session HTTP boundary', () => {
  it('refresh sends refresh_token and returns the rotated session', async () => {
    const id = randomUUID();
    const client = new SupabaseAuthClient(options, (async (url, init) => {
      expect(String(url)).toBe('https://auth.invalid/auth/v1/token?grant_type=refresh_token');
      expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'old-refresh' });
      expect((init?.headers as Record<string, string>).apikey).toBe('public-test');
      return response({ access_token: 'new-access', refresh_token: 'new-refresh', user: { id, email }, expires_in: 3600 });
    }) as typeof fetch);
    expect(await client.refreshSession('old-refresh')).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', user: { id, email } });
  });

  it('transport errors return availability errors without transport details', async () => {
    const client = new SupabaseAuthClient(options, (async () => { throw new TypeError('private transport detail'); }) as typeof fetch);
    await expect(client.refreshSession('old-refresh')).rejects.toMatchObject({ name: 'ServicoIndisponivelException' });
  });
});
