import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { SupabaseAuthClient } from '../src/infrastructure/security/supabase-auth-client.js';
import { AuthService } from '../src/application/services/auth-service.js';
import { FakeSupabase, FakeUsers } from './fakes.js';
import { User } from '../src/domain/user.js';
import { Email } from '../src/domain/email.js';

const options = { url: 'https://auth.example.invalid', anonKey: 'public-key', serviceRoleKey: 'must-not-be-used' };
it('uses the recovery session and public key, never the administrative password endpoint', async () => {
  const calls: { url: string; auth: string; body: unknown }[] = [];
  const client = new SupabaseAuthClient(options, async (input, init) => {
    const url = String(input);
    calls.push({ url, auth: String((init?.headers as Record<string, string>).Authorization), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/verify')) return Response.json({ access_token: 'recovery-session', user: { id: randomUUID(), email: 'maria@teste.com' }, expires_in: 60 });
    return new Response(null, { status: 204 });
  });
  await client.requestPasswordRecovery('maria@teste.com');
  const session = await client.verifyPasswordRecovery('maria@teste.com', '123456');
  await client.updateOwnPassword(session.accessToken, 'NovaSenha123');
  expect(calls.map(c => new URL(c.url).pathname)).toEqual(['/auth/v1/recover', '/auth/v1/verify', '/auth/v1/user', '/auth/v1/logout']);
  expect(calls[1]!.body).toEqual({ type: 'recovery', email: 'maria@teste.com', token: '123456' });
  expect(calls[2]!.auth).toBe('Bearer recovery-session');
  expect(JSON.stringify(calls)).not.toContain(options.serviceRoleKey);
});

it('rejects invalid/expired/provider-rejected OTPs without exposing provider details', async () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    const client = new SupabaseAuthClient(options, async () => Response.json({ secret: 'private provider payload' }, { status }));
    await expect(client.verifyPasswordRecovery('maria@teste.com', '000000')).rejects.toThrow('Código inválido ou expirado.');
  }
  const expired = new SupabaseAuthClient(options, async () => Response.json({ access_token: 'expired', user: { id: randomUUID() }, expires_at: 1 }));
  await expect(expired.verifyPasswordRecovery('maria@teste.com', '123456')).rejects.toThrow('Código inválido ou expirado.');
});

it('does not update another account using a mismatched verification response', async () => {
  const users = new FakeUsers(), auth = new FakeSupabase();
  const id = randomUUID();
  await users.add(User.register(id, 'Maria', Email.create('maria@teste.com'), 'Cliente'));
  auth.recoverySession = { accessToken: 'verified', tokenType: 'bearer', refreshToken: null, expiresAtUtc: new Date(Date.now() + 60000), user: { id, email: 'maria@teste.com' } };
  await expect(new AuthService(users, auth).redefinirSenha({ email: 'outra@teste.com', token: '123456', newPassword: 'NovaSenha123' })).rejects.toThrow('Código inválido ou expirado.');
  expect(auth.senhasAlteradas).toHaveLength(0);
});
