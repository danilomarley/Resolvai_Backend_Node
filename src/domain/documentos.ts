/** Check digits migrated from DocumentoValidator in the C# backend. */
export function normalizarCpf(value?: string | null): string | null {
  const cpf = (value ?? '').trim().replace(/[.-]/g, '');
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return null;
  for (let position = 9; position <= 10; position++) {
    let sum = 0;
    for (let i = 0; i < position; i++) sum += Number(cpf[i]) * (position + 1 - i);
    const digit = (sum * 10) % 11;
    if ((digit === 10 ? 0 : digit) !== Number(cpf[position])) return null;
  }
  return cpf;
}

export function normalizarCnpj(value?: string | null): string | null {
  const cnpj = (value ?? '').trim().replace(/[./-]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(.)\1+$/.test(cnpj)) return null;
  const weights = [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]];
  for (const [index, values] of weights.entries()) {
    const sum = values.reduce((total, weight, i) => total + (cnpj.charCodeAt(i) - 48) * weight, 0);
    const remainder = sum % 11;
    if ((remainder < 2 ? 0 : 11 - remainder) !== Number(cnpj[12 + index])) return null;
  }
  return cnpj;
}
