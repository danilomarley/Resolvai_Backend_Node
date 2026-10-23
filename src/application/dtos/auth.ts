import { z } from 'zod';
import { userResponseSchema } from './users.js';
import { dataIso, emailAddress, obrigatorio, textoObrigatorio } from './validacao.js';

export const loginRequestSchema = z.object({
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320)),
  password: textoObrigatorio('Password', 128)
});

export type LoginRequest = z.output<typeof loginRequestSchema>;

/**
 * Auto-cadastro público. O papel é sempre Cliente; promoção só por um Admin.
 */
export const registerRequestSchema = z.object({
  name: textoObrigatorio('Name', 200),
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320)),
  password: textoObrigatorio('Password', 128, 8)
});

export type RegisterRequest = z.output<typeof registerRequestSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.string(),
  expiresAtUtc: dataIso,
  refreshToken: z.string().optional(),
  user: userResponseSchema
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * Recuperação de senha (#70): confirma que o e-mail tem conta antes de pedir a nova senha.
 */
export const verificarEmailRequestSchema = z.object({
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320))
});

export type VerificarEmailRequest = z.output<typeof verificarEmailRequestSchema>;

export const redefinirSenhaRequestSchema = z.object({
  email: obrigatorio('Email').pipe(emailAddress('Email')).pipe(textoObrigatorio('Email', 320)),
  newPassword: textoObrigatorio('NewPassword', 128, 8)
});

export type RedefinirSenhaRequest = z.output<typeof redefinirSenhaRequestSchema>;
