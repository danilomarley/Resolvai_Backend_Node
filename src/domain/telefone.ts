import { DomainException } from './errors.js';

export function normalizarTelefone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!/^[\d ()+.\-]+$/.test(value) || !/^\d{10,11}$/.test(digits)) {
    throw new DomainException('Telefone deve conter DDD e 10 ou 11 dígitos.');
  }
  return digits;
}
