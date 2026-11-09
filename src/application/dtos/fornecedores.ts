import { z } from 'zod';
import { registerRequestSchema } from './auth.js';
import { textoObrigatorio, textoOpcional } from './validacao.js';

const editaveis = {
  name: textoObrigatorio('Name', 200),
  nomeExibicao: textoObrigatorio('NomeExibicao', 200),
  telefone: textoObrigatorio('Telefone', 20),
  cidadeAtuacao: textoObrigatorio('CidadeAtuacao', 120),
  cidadesAtuacao: z.array(textoObrigatorio('CidadesAtuacao', 120, 2)).min(1).max(30).optional(),
  ufAtuacao: z.string().length(2),
  raioAtendimentoKm: z.number().int().min(1).max(200),
  bio: textoOpcional('Bio', 360),
  registroProfissional: textoOpcional('RegistroProfissional', 80),
  especialidades: z.array(z.string().trim().min(1).max(100)).min(1).max(100)
};

export const registerFornecedorRequestSchema = registerRequestSchema.extend({
  ...editaveis,
  tipoPessoa: z.enum(['PF', 'PJ']),
  cpf: textoOpcional('Cpf', 14),
  cnpj: textoOpcional('Cnpj', 18),
  raioAtendimentoKm: editaveis.raioAtendimentoKm.default(20)
}).strict();
export type RegisterFornecedorRequest = z.output<typeof registerFornecedorRequestSchema>;

/** Authenticated completion binds the existing identity exclusively to the verified Bearer subject. */
export const completeFornecedorRequestSchema = registerFornecedorRequestSchema.omit({ email: true, password: true }).strict();
export type CompleteFornecedorRequest = z.output<typeof completeFornecedorRequestSchema>;

export const atualizarFornecedorRequestSchema = z.object(editaveis).strict();
export type AtualizarFornecedorRequest = z.output<typeof atualizarFornecedorRequestSchema>;

export const fornecedorResponseSchema = z.object({
  idUsuario: z.string(),
  tipoPessoa: z.enum(['PF', 'PJ']),
  name: z.string(), email: z.string(), cpf: z.string().optional(), telefone: z.string(),
  nomeExibicao: z.string(), cnpj: z.string().nullable(), bio: z.string().nullable(),
  cidadeAtuacao: z.string(), ufAtuacao: z.string(), raioAtendimentoKm: z.number(),
  cidadesAtuacao: z.array(z.string()).optional(),
  registroProfissional: z.string().nullable(), especialidades: z.array(z.string()),
  createdAt: z.string(), updatedAt: z.string().nullable()
});
export type FornecedorResponse = z.infer<typeof fornecedorResponseSchema>;

export const especialidadeResponseSchema = z.object({ codigo: z.string(), nome: z.string() });
export type EspecialidadeResponse = z.infer<typeof especialidadeResponseSchema>;
