import { z } from 'zod';
import { statusPedidos } from '../../domain/enums.js';
import { paginaResponseSchema } from './common.js';
import { fotoPedidoResponseSchema, inteiroDaQuery } from './pedidos.js';
import { valorDaQuery } from './propostas.js';
import { statusPropostas } from '../../domain/enums.js';
import { dataIso, textoObrigatorio } from './validacao.js';

// ---------------------------------------------------------------------------------------------
// Catálogo e perfil profissional
// ---------------------------------------------------------------------------------------------

export const categoriaServicoSchema = z.object({ id: z.guid(), slug: z.string(), name: z.string() });
export type CategoriaServico = z.infer<typeof categoriaServicoSchema>;

export const perfilPrestadorResponseSchema = z.object({
  categories: z.array(categoriaServicoSchema),
  cities: z.array(z.string()),
  registrationComplete: z.boolean().describe('CPF, endereço e contato já foram informados.'),
  onboardingComplete: z.boolean().describe('Cadastro finalizado e ao menos uma categoria e uma cidade escolhidas.')
});
export type PerfilPrestador = z.infer<typeof perfilPrestadorResponseSchema>;

export const atualizarPerfilPrestadorSchema = z
  .object({
    categoryIds: z.array(z.guid()).min(1, 'Escolha ao menos uma categoria.').max(20, 'Escolha no máximo 20 categorias.'),
    cities: z.array(textoObrigatorio('Cities', 80, 2)).min(1, 'Informe ao menos uma cidade.').max(30, 'Informe no máximo 30 cidades.')
  })
  .strict();
export type AtualizarPerfilPrestador = z.output<typeof atualizarPerfilPrestadorSchema>;

// ---------------------------------------------------------------------------------------------
// Resumo, feed e detalhe de pedidos
// ---------------------------------------------------------------------------------------------

export const resumoPrestadorResponseSchema = z.object({
  newOrdersLast24h: z.number().int().describe('Pedidos abertos criados nas últimas 24 horas.'),
  compatibleOpenOrders: z.number().int().describe('Pedidos abertos compatíveis com categorias e cidades do prestador.'),
  proposals: z.object({
    total: z.number().int(),
    sent: z.number().int(),
    viewed: z.number().int(),
    chosen: z.number().int(),
    notChosen: z.number().int()
  })
});
export type ResumoPrestador = z.infer<typeof resumoPrestadorResponseSchema>;

export const listarFeedQuerySchema = z.object({
  category: z.string().optional().describe('Slug da categoria (GET /api/v1/catalog/categories).'),
  city: z.string().optional().describe('Cidade contida na localização do pedido, sem diferenciar acentos.'),
  urgency: z.string().optional(),
  q: z.string().optional().describe('Texto no título, categoria ou descrição.'),
  compatible: valorDaQuery('compatible', ['true', 'false']).describe('true: só pedidos compatíveis com o perfil.'),
  page: inteiroDaQuery('page', 1, 2_147_483_647, 1),
  pageSize: inteiroDaQuery('pageSize', 1, 50, 10)
});
export type ListarFeedQuery = z.output<typeof listarFeedQuerySchema>;

export const pedidoFeedItemSchema = z.object({
  id: z.guid(),
  title: z.string(),
  category: z.string().optional(),
  location: z.string().optional(),
  urgency: z.string().optional(),
  createdAt: dataIso,
  proposalsCount: z.number().int(),
  coverPhotoUrl: z.string().optional(),
  customerFirstName: z.string().describe('Só o primeiro nome do contratante, até a contratação.'),
  compatible: z.boolean(),
  myProposalId: z.guid().optional().describe('Proposta que este prestador já enviou ao pedido.')
});
export type PedidoFeedItem = z.infer<typeof pedidoFeedItemSchema>;

export const paginaFeedResponseSchema = paginaResponseSchema(pedidoFeedItemSchema);

// ---------------------------------------------------------------------------------------------
// Propostas do prestador
// ---------------------------------------------------------------------------------------------

export const propostaPrestadorResponseSchema = z.object({
  id: z.guid(),
  orderId: z.guid(),
  orderTitle: z.string(),
  orderCategory: z.string().optional(),
  orderLocation: z.string().optional(),
  orderStatus: z.enum(statusPedidos),
  status: z.enum(statusPropostas),
  value: z.number(),
  deadline: z.string().optional(),
  deadlineDays: z.number().int().optional(),
  description: z.string().optional(),
  warranty: z.string().optional(),
  createdAt: dataIso
});
export type PropostaPrestadorResponse = z.infer<typeof propostaPrestadorResponseSchema>;

export const pedidoPrestadorResponseSchema = pedidoFeedItemSchema.omit({ coverPhotoUrl: true }).extend({
  description: z.string(),
  details: z.string().optional(),
  specifications: z.string().optional(),
  status: z.enum(statusPedidos),
  open: z.boolean().describe('Pedido aberto e sem proposta escolhida: ainda recebe propostas.'),
  photos: z.array(fotoPedidoResponseSchema),
  myProposal: propostaPrestadorResponseSchema.optional()
});
export type PedidoPrestadorResponse = z.infer<typeof pedidoPrestadorResponseSchema>;

const valorDaProposta = z
  .number({ error: 'O campo Value é obrigatório.' })
  .positive('O campo Value deve ser maior que zero.')
  .max(10_000_000, 'O campo Value deve ser no máximo 10.000.000.')
  .refine(valor => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6, 'O campo Value aceita no máximo duas casas decimais.');

export const criarPropostaPrestadorSchema = z
  .object({
    value: valorDaProposta,
    deadlineDays: z
      .number({ error: 'O campo DeadlineDays é obrigatório.' })
      .int('O campo DeadlineDays deve ser um número inteiro de dias.')
      .min(1, 'O campo DeadlineDays deve ser de no mínimo 1 dia.')
      .max(365, 'O campo DeadlineDays deve ser de no máximo 365 dias.'),
    description: textoObrigatorio('Description', 2000, 10),
    warranty: textoObrigatorio('Warranty', 200, 3)
  })
  .strict();
export type CriarPropostaPrestador = z.output<typeof criarPropostaPrestadorSchema>;

export const editarPropostaPrestadorSchema = criarPropostaPrestadorSchema
  .partial()
  .refine(valor => Object.keys(valor).length > 0, 'Informe ao menos um campo para alterar.');
export type EditarPropostaPrestador = z.output<typeof editarPropostaPrestadorSchema>;

export const listarPropostasPrestadorQuerySchema = z.object({
  status: valorDaQuery('status', ['sent', 'viewed', 'chosen', 'notchosen']).describe('Sent, Viewed, Chosen ou NotChosen.'),
  q: z.string().optional().describe('Texto no título do pedido.'),
  page: inteiroDaQuery('page', 1, 2_147_483_647, 1),
  pageSize: inteiroDaQuery('pageSize', 1, 50, 10)
});
export type ListarPropostasPrestadorQuery = z.output<typeof listarPropostasPrestadorQuerySchema>;

export const paginaPropostasPrestadorResponseSchema = paginaResponseSchema(propostaPrestadorResponseSchema).extend({
  counts: z.object({
    total: z.number().int(),
    sent: z.number().int(),
    viewed: z.number().int(),
    chosen: z.number().int(),
    notChosen: z.number().int()
  })
});
