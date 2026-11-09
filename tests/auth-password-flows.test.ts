import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../src/api/routes/auth-routes.js';
import { registrarTratamentoDeErros } from '../src/api/problem-details.js';
import { AuthService } from '../src/application/services/auth-service.js';
import { User } from '../src/domain/user.js';
import { Email } from '../src/domain/email.js';
import { FakeSupabase, FakeUsers } from './fakes.js';

async function setup() {
  const id = randomUUID();
  const users = new FakeUsers();
  const auth = new FakeSupabase();
  await users.add(User.register(id, 'Maria', Email.create('maria@teste.com'), 'Cliente'));
  auth.recoverySession = {
    user: { id, email: 'maria@teste.com' }, accessToken: 'otp-session', refreshToken: null,
    tokenType: 'bearer', expiresAtUtc: new Date(Date.now() + 60000)
  };
  const update = vi.spyOn(auth, 'updateOwnPassword');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarTratamentoDeErros(app);
  await app.register(authRoutes(new AuthService(users, auth), async token => {
    if (token !== 'caller-session') throw new Error('invalid token');
    return { sub: id, email: 'maria@teste.com' };
  }, users));
  return { app, auth, update };
}

describe('OTP recovery and authenticated password change', () => {
  it('keeps OTP delivery and single-use reset public, without accepting a bare password', async () => {
    const { app, auth, update } = await setup();
    try {
      const email = 'maria@teste.com';
      const sent = await app.inject({ method: 'POST', url: '/api/v1/auth/check-email', payload: { email } });
      expect(sent.statusCode).toBe(200);
      expect(auth.recuperacoes).toEqual([{ email, redirectTo: undefined }]);
      const reset = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload });
      expect((await reset({ newPassword: 'NovaSenha123' })).statusCode).toBe(400);
      const payload = { email, token: '123456', newPassword: 'NovaSenha123' };
      expect((await reset(payload)).statusCode).toBe(200);
      expect(update).toHaveBeenCalledExactlyOnceWith('otp-session', 'NovaSenha123');
      expect((await reset(payload)).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it('passes the verified caller token to own-password update and rejects a target identity', async () => {
    const { app, update } = await setup();
    try {
      const change = (payload: object, bearer?: string) => app.inject({
        method: 'POST', url: '/api/v1/auth/change-password', payload,
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {}
      });
      const payload = { newPassword: 'NovaSenha123' };
      expect((await change(payload)).statusCode).toBe(401);
      expect((await change(payload, 'invalid-session')).statusCode).toBe(401);
      expect((await change({ ...payload, email: 'outra@teste.com' }, 'caller-session')).statusCode).toBe(400);
      expect(update).not.toHaveBeenCalled();
      expect((await change(payload, 'caller-session')).statusCode).toBe(200);
      expect(update).toHaveBeenCalledExactlyOnceWith('caller-session', 'NovaSenha123');
    } finally { await app.close(); }
  });
});
