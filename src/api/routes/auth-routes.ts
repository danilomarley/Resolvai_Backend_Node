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
import { semCache, urlAbsoluta } from './util.js';

const mensagemDeLimite = 'Muitas tentativas de recuperação de senha. Aguarde 15 minutos e tente novamente.';

/**
 * Rotas públicas (equivalente ao AuthController com [AllowAnonymous]).
 */
export function authRoutes(authService: AuthService) {
  // Mesmo limite para e-mails existentes/ausentes. Memória por instância + limites do Supabase.
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
        summary: 'Solicita código de recuperação por e-mail sem revelar existência da conta.',
        description: 'Resposta genérica para e-mails existentes e inexistentes. O template de recuperação do Supabase deve conter {{ .Token }}.',
        body: verificarEmailRequestSchema,
        response: { 200: z.object({ message: z.string() }) }
      },
      handler: async (request, reply) => {
        semCache(reply);
        porIp.registrar(`check:${request.ip}`, mensagemDeLimite);
        porEmail.registrar(`check:${request.body.email.trim().toLowerCase()}`, mensagemDeLimite);
        await authService.verificarEmail(request.body);
        return { message: 'Se houver uma conta para este e-mail, você receberá um código de recuperação.' };
      }
    });

    rotas.post('/api/v1/auth/reset-password', {
      schema: {
        tags: ['Auth'],
        summary: 'Recuperação de senha, etapa 2: define a nova senha (#70).',
        description: 'Exige código OTP de recuperação de 6 dígitos, do e-mail informado. O Supabase valida expiração e uso único. Não aceita apenas e-mail/senha nem usa operação administrativa. Nova senha de 8 a 128 caracteres.',
        body: redefinirSenhaRequestSchema,
        response: { 200: z.object({ message: z.string() }) }
      },
      handler: async (request, reply) => {
        semCache(reply);
        porIp.registrar(`reset:${request.ip}`, mensagemDeLimite);
        porEmail.registrar(`reset:${request.body.email.trim().toLowerCase()}`, mensagemDeLimite);
        await authService.redefinirSenha(request.body);
        return { message: 'Senha redefinida.' };
      }
    });
  };
}
