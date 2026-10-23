import type { FastifyReply, FastifyRequest } from 'fastify';
import { normalizarGuid } from '../guid.js';

/**
 * URL absoluta para o header Location, como o CreatedAtRoute/CreatedAtAction do ASP.NET.
 */
export function urlAbsoluta(request: FastifyRequest, caminho: string): string {
  return `${request.protocol}://${request.host}${caminho}`;
}

/**
 * Equivalente ao [ResponseCache(NoStore = true, Location = None)] dos controllers de pedidos e Home.
 */
export function semCache(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store,no-cache');
  reply.header('Pragma', 'no-cache');
}

/**
 * Lê o parâmetro {id:guid}. Fora do formato, a rota responde 404 como o ASP.NET, que nem casaria a rota.
 */
export function guidDaRota(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): string | undefined {
  const id = normalizarGuid(request.params.id);
  if (!id) {
    reply.callNotFound();
  }

  return id;
}
