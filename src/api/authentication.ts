import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import type { CurrentUser, IUserRepository } from '../application/contracts.js';
import { parseUserRole, UserRole } from '../domain/enums.js';
import { normalizarGuid } from './guid.js';
import { enviarProblema } from './problem-details.js';

export interface AuthenticationOptions {
  /** {SUPABASE_URL}/auth/v1 */
  authIssuer: string;
  audience: string;
  /** Segredo HS256 do projeto, mantido para tokens antigos. Chaves assimétricas vêm do JWKS. */
  jwtSecret: string;
}

export type VerificarToken = (token: string) => Promise<JWTPayload>;

declare module 'fastify' {
  interface FastifyRequest {
    usuario: CurrentUser;
  }
}

class FalhaDeAutenticacao extends Error {}

const algoritmos = ['HS256', 'ES256', 'RS256'];

/**
 * Valida o access token do Supabase: emissor, audiência, expiração (1 minuto de tolerância)
 * e assinatura pelo JWKS do projeto ou pelo segredo HS256 legado.
 */
export function criarVerificadorDeToken(options: AuthenticationOptions): VerificarToken {
  const jwks = createRemoteJWKSet(new URL(`${options.authIssuer}/.well-known/jwks.json`));
  const segredo = options.jwtSecret ? new TextEncoder().encode(options.jwtSecret) : undefined;
  const opcoes = {
    issuer: options.authIssuer,
    audience: options.audience,
    algorithms: algoritmos,
    clockTolerance: 60,
    requiredClaims: ['exp']
  };

  return async token => {
    const { alg } = decodeProtectedHeader(token);

    if (alg === 'HS256') {
      if (!segredo) {
        throw new FalhaDeAutenticacao('Token HS256 sem segredo configurado.');
      }

      return (await jwtVerify(token, segredo, opcoes)).payload;
    }

    return (await jwtVerify(token, jwks, opcoes)).payload;
  };
}

/**
 * Hook de autenticação das rotas protegidas (equivalente ao [Authorize] + JwtBearer da API C#).
 *
 * O JWT do Supabase traz role=authenticated. Substituímos pela role do perfil local (Cliente/Prestador/Admin).
 * Usuário sem perfil local ainda (cadastro não finalizado) segue autenticado só com as claims do Supabase,
 * para poder chamar a rota de finalização de cadastro.
 */
export function criarHookDeAutenticacao(verificarToken: VerificarToken, userRepository: IUserRepository) {
  return async function autenticar(request: FastifyRequest, reply: FastifyReply) {
    const token = extrairBearer(request.headers.authorization);
    if (!token) {
      reply.header('WWW-Authenticate', 'Bearer');
      return enviarProblema(reply, 401);
    }

    let payload: JWTPayload;
    try {
      payload = await verificarToken(token);
    } catch (error) {
      request.log.info(`Falha na validação do token: ${(error as Error).message}`);
      reply.header('WWW-Authenticate', 'Bearer error="invalid_token"');
      return enviarProblema(reply, 401);
    }

    const id = typeof payload.sub === 'string' ? normalizarGuid(payload.sub) : undefined;
    if (!id) {
      request.log.info('Token sem identificador de usuário (sub).');
      return enviarProblema(reply, 401);
    }

    const user = await userRepository.getById(id);

    if (user && !user.isActive) {
      request.log.info('Usuário inativo.');
      return enviarProblema(reply, 401);
    }

    const emailDoToken = typeof payload.email === 'string' && payload.email ? payload.email : undefined;
    const roleDoToken = typeof payload.role === 'string' ? parseUserRole(payload.role) : undefined;

    request.usuario = {
      isAuthenticated: true,
      id,
      email: emailDoToken ?? user?.email.value,
      role: user ? user.role : roleDoToken
    };
  };
}

/**
 * Equivalente ao [Authorize(Roles = "Admin")]: 403 para quem está autenticado sem o papel.
 */
export async function exigirAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.usuario.role !== UserRole.Admin) {
    return enviarProblema(reply, 403);
  }
}

function extrairBearer(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
