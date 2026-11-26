import { z } from 'zod';
import { dataIso, obrigatorio } from './validacao.js';

export const statusContratos = ['Pending', 'Signed'] as const;
export type StatusContrato = (typeof statusContratos)[number];

/**
 * Contrato de prestação de serviços (#95). O texto é o que as partes leem e assinam; `textHash` identifica
 * exatamente esse texto e volta no corpo da assinatura.
 */
export const contratoResponseSchema = z.object({
  id: z.guid(),
  orderId: z.guid(),
  proposalId: z.guid(),
  status: z.enum(statusContratos).describe('Pending até as duas partes assinarem; depois Signed, o que libera o pagamento.'),
  templateVersion: z.string(),
  text: z.string().describe('Texto integral, com quebras de linha.'),
  textHash: z.string().describe('SHA-256 do texto, em hexadecimal.'),
  value: z.number(),
  customerName: z.string(),
  providerName: z.string(),
  customerSignedAt: dataIso.optional().describe('Quando o contratante assinou.'),
  providerSignedAt: dataIso.optional().describe('Quando o prestador assinou.'),
  createdAt: dataIso
});

export type ContratoResponse = z.infer<typeof contratoResponseSchema>;

export const assinarContratoRequestSchema = z.object({
  textHash: obrigatorio('TextHash')
    .pipe(z.string().regex(/^[0-9a-fA-F]{64}$/, 'O campo TextHash deve ser o SHA-256 do texto do contrato.'))
    .describe('Hash do texto que a pessoa leu, devolvido pelo GET do contrato.')
});

export type AssinarContratoRequest = z.output<typeof assinarContratoRequestSchema>;
