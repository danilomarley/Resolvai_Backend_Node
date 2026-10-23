import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { loginRequestSchema, loginResponseSchema, registerRequestSchema } from '../../application/dtos/auth.js';
import { userResponseSchema } from '../../application/dtos/users.js';
import type { AuthService } from '../../application/services/auth-service.js';
import { urlAbsoluta } from './util.js';

/**
 * Rotas públicas (equivalente ao AuthController com [AllowAnonymous]).
 */
export function authRoutes(authService: AuthService) {
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
  };
}
