const formatoD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const formatoN = /^[0-9a-f]{32}$/i;

/**
 * Equivale à restrição de rota {id:guid} do ASP.NET: aceita os formatos D, N, B ({...}) e P ((...))
 * e devolve o UUID em minúsculas com hífens. Retorna undefined quando não é um Guid.
 */
export function normalizarGuid(valor: string): string | undefined {
  let texto = valor.trim();

  if ((texto.startsWith('{') && texto.endsWith('}')) || (texto.startsWith('(') && texto.endsWith(')'))) {
    texto = texto.slice(1, -1);
  }

  if (formatoN.test(texto)) {
    texto = `${texto.slice(0, 8)}-${texto.slice(8, 12)}-${texto.slice(12, 16)}-${texto.slice(16, 20)}-${texto.slice(20)}`;
  }

  return formatoD.test(texto) ? texto.toLowerCase() : undefined;
}
