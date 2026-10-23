import { z } from 'zod';

// Equivalentes das DataAnnotations usadas nos DTOs da API C#.
// As mensagens seguem o formato padrão do ASP.NET, traduzido.

/** [Required]: rejeita nulo, vazio e só espaços. Não altera o valor recebido. */
export const obrigatorio = (campo: string) =>
  z
    .string({ error: `O campo ${campo} é obrigatório.` })
    .refine(valor => valor.trim().length > 0, { message: `O campo ${campo} é obrigatório.` });

/** [MaxLength]/[MinLength] sobre um texto. */
export const tamanho = (campo: string, min: number | undefined, max: number) =>
  z
    .string()
    .refine(valor => min === undefined || valor.length >= min, {
      message: `O campo ${campo} deve ter no mínimo ${min} caracteres.`
    })
    .refine(valor => valor.length <= max, { message: `O campo ${campo} deve ter no máximo ${max} caracteres.` });

/** Texto obrigatório com limites de tamanho. */
export const textoObrigatorio = (campo: string, max: number, min?: number) =>
  obrigatorio(campo).pipe(tamanho(campo, min, max));

/** Texto opcional (aceita ausente ou null) com limite de tamanho. */
export const textoOpcional = (campo: string, max: number) => tamanho(campo, undefined, max).nullish();

/** [EmailAddress]: exatamente um @, que não pode ser o primeiro nem o último caractere. */
export const emailAddress = (campo: string) =>
  z.string().refine(
    valor => {
      const arroba = valor.indexOf('@');
      return arroba > 0 && arroba === valor.lastIndexOf('@') && arroba < valor.length - 1;
    },
    { message: `O campo ${campo} não é um endereço de e-mail válido.` }
  );

/** [Url]: aceita apenas http://, https:// e ftp://. */
export const url = (campo: string) =>
  z.string().refine(valor => /^(https?|ftp):\/\/.+/i.test(valor), {
    message: `O campo ${campo} não é uma URL http, https ou ftp válida.`
  });

/** Data em ISO 8601, como o System.Text.Json serializa DateTime/DateTimeOffset. */
export const dataIso = z.string().describe('Data e hora em ISO 8601 (UTC).');
