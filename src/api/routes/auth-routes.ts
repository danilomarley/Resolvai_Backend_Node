import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  loginRequestSchema,
  loginResponseSchema,
  redefinirSenhaRequestSchema,
  registerRequestSchema,
  verificarEmailRequestSchema
} from '../../application/dtos/auth.js';
import { userResponseSchema } from '../../application/dtos/users.js';
import type { AuthService } from '../../application/services/auth-service.js';
import { LimitadorDeTentativas } from '../limitador.js';
import { urlAbsoluta } from './util.js';

const mensagemDeLimite = 'Muitas tentativas de recuperação de senha. Aguarde 15 minutos e tente novamente.';

/**
 * Rotas públicas (equivalente ao AuthController com [AllowAnonymous]).
 */
export function authRoutes(authService: AuthService) {
  // O fluxo da #70 troca a senha sem confirmação por e-mail; limitar tentativas reduz abuso e varredura de e-mails.
  const porIp = new LimitadorDeTentativas(10, 15 * 60 * 1000);
  const porEmail = new LimitadorDeTentativas(5, 15 * 60 * 1000);

  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();

    rotas.post('/api/v1/auth/login', {
      schema: {
        tags: ['Auth'],
        summary: 'Autentica via Supabase Auth e devolve o Bearer token.',
        body: loginRequestSchema,
        response: { 200: loginResponseSchema }
      },
      handler: request => authService.login(request.body)
    });

    rotas.post('/api/v1/auth/register', {
      schema: {
        tags: ['Auth'],
        summary: 'Auto-cadastro público no Supabase Auth. O perfil local sempre nasce com o papel Cliente.',
        body: registerRequestSchema,
        response: { 201: userResponseSchema }
      },
      handler: async (request, reply) => {
        const user = await authService.register(request.body);
        return reply.code(201).header('Location', urlAbsoluta(request, `/api/v1/users/${user.id}`)).send(user);
      }
    });

    rotas.post('/api/v1/auth/check-email', {
      schema: {
        tags: ['Auth'],
        summary: 'Recuperação de senha, etapa 1: confirma que o e-mail tem conta (#70).',
        description: 'Responde 200 quando existe conta ativa para o e-mail e 404 quando não existe.',
        body: verificarEmailRequestSchema,
        response: { 200: z.object({ email: z.string() }) }
      },
      handler: async request => {
        porIp.registrar(`check:${request.ip}`, mensagemDeLimite);
        await authService.verificarEmail(request.body);
        return { email: request.body.email.trim().toLowerCase() };
      }
    });

    rotas.post('/api/v1/auth/reset-password', {
      schema: {
        tags: ['Auth'],
        summary: 'Recuperação de senha, etapa 2: define a nova senha (#70).',
        description: 'A nova senha precisa ter de 8 a 128 caracteres.',
        body: redefinirSenhaRequestSchema,
        response: { 200: z.object({ message: z.string() }) }
      },
      handler: async request => {
        porIp.registrar(`reset:${request.ip}`, mensagemDeLimite);
        porEmail.registrar(`reset:${request.body.email.trim().toLowerCase()}`, mensagemDeLimite);
        await authService.redefinirSenha(request.body);
        return { message: 'Senha redefinida.' };
      }
    });
  };
}
