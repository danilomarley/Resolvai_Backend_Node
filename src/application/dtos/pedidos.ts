import { z } from 'zod';
import { statusPedidos, statusPropostas } from '../../domain/enums.js';
import { paginaResponseSchema } from './common.js';
import { dataIso, obrigatorio, tamanho, textoObrigatorio, textoOpcional, url } from './validacao.js';

export const maxPageSize = 50;

const inteiroDaQuery = (campo: string, min: number, max: number, padrao: number) =>
  z
    .string()
    .optional()
    .transform((valor, ctx) => {
      if (valor === undefined) {
        return padrao;
      }

      const numero = Number(valor);
      if (!/^\s*-?\d+\s*$/.test(valor) || !Number.isSafeInteger(numero)) {
        ctx.addIssue({ code: 'custom', message: `O valor '${valor}' não é válido para ${campo}.` });
        return z.NEVER;
      }

      if (numero < min || numero > max) {
        ctx.addIssue({ code: 'custom', message: `O campo ${campo} deve estar entre ${min} e ${max}.` });
        return z.NEVER;
      }

      return numero;
    });

/**
 * Parâmetros de query de GET /api/v1/orders. Os nomes seguem o contrato da API (status, page, pageSize).
 */
export const listarPedidosQuerySchema = z.object({
  // Filtro opcional, sem diferenciar maiúsculas como o binding de enum do ASP.NET.
  status: z
    .string()
    .optional()
    .transform((valor, ctx) => {
      if (valor === undefined || valor === '') {
        return undefined;
      }

      const status = statusPedidos.find(item => item.toLowerCase() === valor.trim().toLowerCase());
      if (!status) {
        ctx.addIssue({ code: 'custom', message: `O valor '${valor}' não é válido para status.` });
        return z.NEVER;
      }

      return status;
    })
    .describe('Pending, InProgress, Completed ou Cancelled. Sem valor, lista todos os status.'),
  page: inteiroDaQuery('page', 1, 2_147_483_647, 1).describe('Página a partir de 1 (padrão 1).'),
  pageSize: inteiroDaQuery('pageSize', 1, maxPageSize, 10).describe('Itens por página, entre 1 e 50 (padrão 10).')
});

export type ListarPedidosQuery = z.output<typeof listarPedidosQuerySchema>;

export const novaFotoPedidoRequestSchema = z.object({
  url: obrigatorio('Url').pipe(url('Url')).pipe(tamanho('Url', undefined, 2048)),
  descricao: textoOpcional('Descricao', 200)
});

export type NovaFotoPedidoRequest = z.output<typeof novaFotoPedidoRequestSchema>;

export const criarPedidoRequestSchema = z.object({
  titulo: textoOpcional('Titulo', 90),
  categoria: textoObrigatorio('Categoria', 80),
  descricao: textoObrigatorio('Descricao', 2000, 10),
  localizacao: textoObrigatorio('Localizacao', 200, 3),
  detalhes: textoOpcional('Detalhes', 2000),
  urgencia: textoOpcional('Urgencia', 40),
  especificacoes: textoOpcional('Especificacoes', 2000),
  fotos: z
    .array(novaFotoPedidoRequestSchema)
    .max(4, 'O campo Fotos deve ter no máximo 4 itens.')
    .nullish()
    .transform(fotos => fotos ?? [])
});

export type CriarPedidoRequest = z.output<typeof criarPedidoRequestSchema>;

/**
 * Item de listagem: usado em Seus Pedidos e nos pedidos recentes da Home.
 */
export const pedidoResumoResponseSchema = z.object({
  id: z.guid(),
  title: z.string(),
  category: z.string().optional(),
  status: z.enum(statusPedidos),
  createdAt: dataIso,
  updatedAt: dataIso.optional(),
  proposalsCount: z.number().int(),
  chosenProposalValue: z.number().optional()
});

export type PedidoResumoResponse = z.infer<typeof pedidoResumoResponseSchema>;

export const fotoPedidoResponseSchema = z.object({
  id: z.guid(),
  url: z.string(),
  description: z.string().optional()
});

export type FotoPedidoResponse = z.infer<typeof fotoPedidoResponseSchema>;

export const propostaResponseSchema = z.object({
  id: z.guid(),
  providerId: z.guid(),
  providerName: z.string(),
  status: z.enum(statusPropostas),
  value: z.number(),
  deadline: z.string().optional(),
  description: z.string().optional(),
  warranty: z.string().optional()
});

export type PropostaResponse = z.infer<typeof propostaResponseSchema>;

export const pedidoResponseSchema = z.object({
  id: z.guid(),
  title: z.string(),
  category: z.string().optional(),
  description: z.string(),
  location: z.string().optional(),
  status: z.enum(statusPedidos),
  createdAt: dataIso,
  updatedAt: dataIso.optional(),
  scope: z.unknown().optional().describe('Conteúdo completo de pedidos.escopo.'),
  photos: z.array(fotoPedidoResponseSchema),
  proposals: z.array(propostaResponseSchema)
});

export type PedidoResponse = z.infer<typeof pedidoResponseSchema>;

export const paginaPedidosResponseSchema = paginaResponseSchema(pedidoResumoResponseSchema);

export const pedidoIdParamsSchema = z.object({ id: z.string() });

