import { z } from 'zod';
import { parseUserRole, UserRole, userRoles } from '../../domain/enums.js';
import { dataIso, emailAddress, obrigatorio, textoObrigatorio, textoOpcional } from './validacao.js';

export const userResponseSchema = z.object({
  id: z.guid(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  createdAt: dataIso,
  cpf: z.string().optional()
});

export type UserResponse = z.infer<typeof userResponseSchema>;

export const createUserRequestSchema = z.object({
  name: textoObrigatorio('Name', 200),
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320)),
  password: textoObrigatorio('Password', 128, 8),
  // O System.Text.Json lê enums sem diferenciar maiúsculas; o padrão é Cliente.
  role: z
    .string()
    .nullish()
    .transform((valor, ctx) => {
      if (valor === undefined || valor === null) {
        return UserRole.Cliente;
      }

      const role = parseUserRole(valor);
      if (!role) {
        ctx.addIssue({ code: 'custom', message: `O campo Role deve ser ${userRoles.join(', ')}.` });
        return z.NEVER;
      }

      return role;
    })
});

export type CreateUserRequest = z.output<typeof createUserRequestSchema>;

export const setUserStatusRequestSchema = z.object({
  isActive: z.boolean({ error: 'O campo IsActive é obrigatório.' })
});

export type SetUserStatusRequest = z.output<typeof setUserStatusRequestSchema>;

export const enderecoRequestSchema = z.object({
  logradouro: textoObrigatorio('Logradouro', 200),
  numero: textoObrigatorio('Numero', 20),
  complemento: textoOpcional('Complemento', 200),
  bairro: textoObrigatorio('Bairro', 120),
  cidade: textoObrigatorio('Cidade', 120),
  estado: textoObrigatorio('Estado', 2).pipe(z.string().regex(/^[A-Za-z]{2}$/, 'Estado inválido.')),
  cep: textoObrigatorio('Cep', 9).pipe(z.string().regex(/^(\d{8}|\d{5}-\d{3})$/, 'CEP inválido.')),
  apelido: textoOpcional('Apelido', 60),
  latitude: z.number().nullish(),
  longitude: z.number().nullish()
});

export const contatoRequestSchema = z.object({
  tipo: obrigatorio('Tipo').pipe(
    z.string().regex(/^(telefone|whatsapp|email_alt)$/, "O campo Tipo deve ser 'telefone', 'whatsapp' ou 'email_alt'.")
  ),
  valor: textoObrigatorio('Valor', 60)
});

/**
 * Completa o cadastro do usuário autenticado no Supabase: CPF, endereço e contato.
 */
export const completeRegistrationRequestSchema = z.object({
  name: textoObrigatorio('Name', 200),
  cpf: textoObrigatorio('Cpf', 14).pipe(z.string().regex(/^(\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/, 'CPF inválido.')),
  endereco: enderecoRequestSchema,
  contato: contatoRequestSchema
});

export type CompleteRegistrationRequest = z.output<typeof completeRegistrationRequestSchema>;
