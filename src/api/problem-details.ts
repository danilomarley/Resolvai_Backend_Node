import { randomBytes } from 'node:crypto';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ConflictException, NotFoundException, UnauthorizedException } from '../application/errors.js';
import { DomainException } from '../domain/errors.js';

// Mesmos "type" e "title" padrão que o AddProblemDetails do ASP.NET Core usa (RFC 9110).
const tipos: Record<number, string> = {
  400: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
  401: 'https://tools.ietf.org/html/rfc9110#section-15.5.2',
  403: 'https://tools.ietf.org/html/rfc9110#section-15.5.4',
  404: 'https://tools.ietf.org/html/rfc9110#section-15.5.5',
  405: 'https://tools.ietf.org/html/rfc9110#section-15.5.6',
  409: 'https://tools.ietf.org/html/rfc9110#section-15.5.10',
  413: 'https://tools.ietf.org/html/rfc9110#section-15.5.14',
  415: 'https://tools.ietf.org/html/rfc9110#section-15.5.16',
  500: 'https://tools.ietf.org/html/rfc9110#section-15.6.1'
};

const titulos: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  500: 'An error occurred while processing your request.'
};

export interface Problema {
  /** Padrão application/problem+json. Validação usa application/json, como o [Produces] do ApiControllerBase. */
  contentType?: string;
  title?: string;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}

/**
 * Identificador de rastreio no formato W3C traceparent, como o traceId do ASP.NET.
 */
export function gerarTraceId(): string {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-00`;
}

/**
 * Responde no formato ProblemDetails (RFC 9457), o mesmo que o front já trata.
 */
export function enviarProblema(reply: FastifyReply, status: number, problema: Problema = {}): FastifyReply {
  return reply
    .code(status)
    .type(problema.contentType ?? 'application/problem+json')
    .send({
      type: tipos[status],
      title: problema.title ?? titulos[status],
      status,
      detail: problema.detail,
      instance: problema.instance,
      errors: problema.errors,
      traceId: String(reply.request.id)
    });
}

const tituloValidacao = 'One or more validation errors occurred.';
const tipoValidacao = 'application/json; charset=utf-8';

/**
 * Chave no formato do ModelState do ASP.NET: propriedades em PascalCase e índices entre colchetes
 * ("/endereco/cep" vira "Endereco.Cep" e "/fotos/0/url" vira "Fotos[0].Url").
 */
export function chaveDoModelState(instancePath: string): string {
  return instancePath
    .split('/')
    .filter(Boolean)
    .reduce((chave, parte) => {
      if (/^\d+$/.test(parte)) return `${chave}[${parte}]`;
      const nome = parte.charAt(0).toUpperCase() + parte.slice(1);
      return chave ? `${chave}.${nome}` : nome;
    }, '');
}

function errosDeValidacao(error: FastifyError): Record<string, string[]> {
  const erros: Record<string, string[]> = {};

  for (const item of error.validation ?? []) {
    const chave = chaveDoModelState(item.instancePath) || 'request';
    (erros[chave] ??= []).push(item.message ?? 'Valor inválido.');
  }

  return erros;
}

/**
 * O ExceptionHandler do ASP.NET limpa os headers e marca a resposta de erro como não cacheável.
 */
function semCacheDeErro(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-cache,no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '-1');
}

/**
 * Traduz exceções de domínio e de aplicação em ProblemDetails, como o GlobalExceptionHandler da API C#.
 */
export function registrarTratamentoDeErros(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      request.log.info({ errors: error.validation }, 'Requisição rejeitada por validação.');
      reply.removeHeader('Cache-Control').removeHeader('Pragma');
      return enviarProblema(reply, 400, { contentType: tipoValidacao, title: tituloValidacao, errors: errosDeValidacao(error) });
    }

    const instance = `${request.method} ${request.url.split('?')[0]}`;
    const traduzido = traduzir(error);

    if (traduzido) {
      request.log.info(
        `Requisição ${instance} rejeitada com ${traduzido.status}: ${error.message}`
      );
      semCacheDeErro(reply);
      return enviarProblema(reply, traduzido.status, { title: traduzido.title, detail: error.message, instance });
    }

    // Erros do próprio Fastify (JSON inválido, corpo vazio, media type não suportado, corpo grande demais).
    const statusCode = error.statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      request.log.info(`Requisição ${instance} rejeitada com ${statusCode}: ${error.message}`);
      reply.removeHeader('Cache-Control').removeHeader('Pragma');
      return statusCode === 400
        ? enviarProblema(reply, 400, { contentType: tipoValidacao, title: tituloValidacao, errors: { $: [error.message] } })
        : enviarProblema(reply, statusCode);
    }

    request.log.error({ err: error }, `Erro não tratado em ${instance}.`);
    semCacheDeErro(reply);
    // Mensagem genérica: detalhes de exceções inesperadas ficam apenas no log.
    return enviarProblema(reply, 500, {
      title: 'Erro interno',
      detail: 'Ocorreu um erro inesperado ao processar a requisição.',
      instance
    });
  });

  app.setNotFoundHandler((_request, reply) => enviarProblema(reply, 404));
}

function traduzir(error: Error): { status: number; title: string } | undefined {
  if (error instanceof UnauthorizedException) return { status: 401, title: 'Não autorizado' };
  if (error instanceof NotFoundException) return { status: 404, title: 'Recurso não encontrado' };
  if (error instanceof ConflictException) return { status: 409, title: 'Conflito' };
  if (error instanceof DomainException) return { status: 400, title: 'Requisição inválida' };
  return undefined;
}
