/** Only server-generated paths belonging to this proposal may be deleted. */
export function caminhosDoPortfolio(portfolio: unknown, providerId: string, proposalId: string): string[] {
  if (!Array.isArray(portfolio)) return [];
  const prefix = `propostas/${providerId}/${proposalId}/`;
  return [...new Set(portfolio.flatMap(item => {
    if (!item || typeof item.url !== 'string') return [];
    try {
      const pathname = decodeURIComponent(new URL(item.url).pathname);
      const start = pathname.lastIndexOf(`/${prefix}`);
      if (start === -1) return [];
      const path = pathname.slice(start + 1);
      const suffix = path.slice(prefix.length);
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-4]\.(png|jpg)$/i.test(suffix) ? [path] : [];
    } catch {
      return [];
    }
  }))];
}
