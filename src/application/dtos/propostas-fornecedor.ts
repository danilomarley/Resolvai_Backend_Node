import { z } from 'zod';
import { statusPropostas } from '../../domain/enums.js';

const optionalText = (max: number) => z.string().trim().max(max).optional().transform(value => value || undefined);
export const criarPropostaSchema = z.object({
  requestId: z.guid().transform(value => value.toLowerCase()),
  valueCents: z.number().int().min(1).max(99_999_999_999),
  deadline: z.enum(['1 dia', '2 dias', '3 dias', '5 dias', '7 dias', '10 dias', '15 dias', '20 dias', '30 dias', '45 dias', '60 dias']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Data de início inválida.').optional(),
  description: z.string().trim().min(20).max(2000),
  materials: optionalText(1000),
  guaranteePeriod: z.enum(['30 dias', '60 dias', '90 dias', '180 dias', '1 ano']),
  guaranteeType: z.enum(['Reexecução gratuita', 'Reparo sem custo', 'Manutenção sem custo', 'Reembolso do valor']),
  guaranteeConditions: optionalText(1000)
}).strict();
export type CriarProposta = z.output<typeof criarPropostaSchema>;
export const propostaEnviadaSchema = z.object({
  id: z.guid(), orderId: z.guid(), status: z.enum(statusPropostas),
  value: z.number(), deadline: z.string().optional(), startDate: z.string().optional(),
  description: z.string().optional(), materials: z.string().optional(),
  warranty: z.object({ period: z.string().optional(), type: z.string().optional(), conditions: z.string().optional(), text: z.string().optional() }),
  portfolio: z.array(z.object({ url: z.string(), name: z.string() })), createdAt: z.string()
});
export type PropostaEnviada = z.infer<typeof propostaEnviadaSchema>;
export interface ArquivoPortfolio { conteudo: Buffer; contentType: string; name: string; }
export interface PropostaRegistro { proposal: PropostaEnviada; providerId: string; payloadHash: string | null; }
export interface IPropostaFornecedorRepository {
  find(id: string): Promise<PropostaRegistro | null>;
  assertAvailable(orderId: string, providerId: string): Promise<void>;
  create(orderId: string, providerId: string, data: CriarProposta, hash: string, portfolio: PropostaEnviada['portfolio']): Promise<{ proposal: PropostaEnviada; created: boolean }>;
}
