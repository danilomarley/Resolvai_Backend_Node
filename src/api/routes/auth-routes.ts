import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  alterarSenhaRequestSchema,
  loginRequestSchema,
  loginResponseSchema,
  providerLoginResponseSchema,
  refreshRequestSchema,
  recuperarSenhaRequestSchema,
  redefinirSenhaRequestSchema,
  registerRequestSchema,
  verificarEmailRequestSchema
} from '../../application/dtos/auth.js';
import { userResponseSchema } from '../../application/dtos/users.js';
import type { AuthService } from '../../application/services/auth-service.js';
import { LimitadorDeTentativas } from '../limitador.js';
import { semCache, urlAbsoluta } from './util.js';
import { criarHookDeAutenticacao, type VerificarToken } from '../authentication.js';
import type { IUserRepository } from '../../application/contracts.js';
import { DomainException } from '../../domain/errors.js';

const mensagemDeLimite = 'Muitas tentativas de recuperação de senha. Aguarde 15 minutos e tente novamente.';

/**
 * Rotas públicas (equivalente ao AuthController com [AllowAnonymous]).
 */
export function authRoutes(authService: AuthService, verificarToken: VerificarToken, users: IUserRepository, allowedOrigins: string[] = []) {
  const porIp = new LimitadorDeTentativas(10, 15 * 60 * 1000);
  const porEmail = new LimitadorDeTentativas(5, 15 * 60 * 1000);
  const porUsuario = new LimitadorDeTentativas(5, 15 * 60 * 1000);
  const cadastrosPorIp = new LimitadorDeTentativas(10, 15 * 60 * 1000);
  const recuperacoesPorEmail = new LimitadorDeTentativas(1, 60 * 1000);

  return async (app: FastifyInstance) => {
    app.addHook('preHandler', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
    const rotas = app.withTypeProvider<ZodTypeProvider>();

    rotas.post('/api/v1/auth/login-provider', {
      schema: { tags: ['Auth'], summary: 'Autentica a conta e informa se falta ativar o perfil profissional.', body: loginRequestSchema, response: { 200: providerLoginResponseSchema } },
      handler: request => authService.loginProvider(request.body)
    });

    rotas.post('/api/v1/auth/refresh-provider', {
      schema: { tags: ['Auth'], summary: 'Renova a sessão do portal do Fornecedor e revalida sua ativação.', body: refreshRequestSchema, response: { 200: providerLoginResponseSchema } },
      handler: request => authService.refreshProvider(request.body.refreshToken)
    });

    rotas.post('/api/v1/auth/refresh', {
      schema: { tags: ['Auth'], summary: 'Renova a sessão e revalida o perfil local ativo.', body: refreshRequestSchema, response: { 200: loginResponseSchema } },
      handler: request => authService.refresh(request.body.refreshToken)
    });

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
      onRequest: async request => { cadastrosPorIp.registrar(request.ip, 'Muitas tentativas de cadastro. Aguarde 15 minutos e tente novamente.'); },
      schema: {
        tags: ['Auth'],
        summary: 'Auto-cadastro conforme a política do Supabase Auth. O perfil local sempre nasce com o papel Cliente.',
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
        description: 'O template de recuperação do Supabase deve conter {{ .Token }}.',
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

    rotas.post('/api/v1/auth/forgot-password', {
      onRequest: async request => { porIp.registrar(`forgot:${request.ip}`, mensagemDeLimite); },
      schema: {
        tags: ['Auth'],
        summary: 'Envia o link de recuperação pelo Supabase Auth, sem divulgar a existência da conta.',
        body: recuperarSenhaRequestSchema,
        response: { 200: z.object({ message: z.string() }) }
      },
      handler: async request => {
        const redirect = new URL(request.body.redirectTo);
        if (!['http:', 'https:'].includes(redirect.protocol) || redirect.username || redirect.password
          || redirect.pathname !== '/redefinir-senha' || redirect.search || redirect.hash
          || !allowedOrigins.includes(redirect.origin)) {
          throw new DomainException('Endereço de retorno da recuperação não permitido.');
        }
        const email = request.body.email.trim().toLowerCase();
        recuperacoesPorEmail.registrar(email, 'Aguarde um minuto antes de solicitar outro link.');
        await authService.solicitarRecuperacao(email, redirect.href);
        return { message: 'Se houver uma conta associada a este e-mail, você receberá um link para redefinir sua senha.' };
      }
    });

    rotas.post('/api/v1/auth/reset-password', {
      schema: {
        tags: ['Auth'],
        summary: 'Redefine a senha com código OTP de recuperação.',
        description: 'Exige e-mail e código de recuperação de 6 dígitos, validado e consumido pelo Supabase. Não usa operação administrativa.',
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

    rotas.post('/api/v1/auth/change-password', {
      onRequest: criarHookDeAutenticacao(verificarToken, users),
      schema: {
        security: [{ Bearer: [] }],
        tags: ['Auth'],
        summary: 'Altera a própria senha com a sessão Bearer verificada.',
        body: alterarSenhaRequestSchema,
        response: { 200: z.object({ message: z.string() }) }
      },
      handler: async request => {
        porIp.registrar(`change:${request.ip}`, mensagemDeLimite);
        porUsuario.registrar(`change:${request.usuario.id}`, mensagemDeLimite);
        const accessToken = request.headers.authorization!.match(/^Bearer\s+(.+)$/i)![1]!.trim();
        await authService.alterarSenha(request.body, request.usuario, accessToken);
        return { message: 'Senha alterada.' };
      }
    });
  };
}
