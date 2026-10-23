import type { IArmazenamentoFotos } from '../../application/contracts.js';
import { DomainException } from '../../domain/errors.js';

export interface SupabaseStorageOptions {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

const timeoutMs = 60_000;

/**
 * Grava arquivos no Supabase Storage com a service key (o front não acessa o Storage diretamente).
 * O bucket é público para leitura: a URL devolvida pode ir direto para fotos_pedido.foto.
 */
export class SupabaseStorage implements IArmazenamentoFotos {
  private readonly baseUrl: string;

  constructor(
    private readonly options: SupabaseStorageOptions,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.baseUrl = options.url.replace(/\/+$/, '');
  }

  async enviar(caminho: string, conteudo: Buffer, contentType: string): Promise<string> {
    const destino = `${encodeURIComponent(this.options.bucket)}/${caminho.split('/').map(encodeURIComponent).join('/')}`;

    const response = await this.fetcher(`${this.baseUrl}/storage/v1/object/${destino}`, {
      method: 'POST',
      headers: {
        apikey: this.options.serviceRoleKey,
        Authorization: `Bearer ${this.options.serviceRoleKey}`,
        'Content-Type': contentType,
        'x-upsert': 'false'
      },
      body: new Uint8Array(conteudo),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      const detalhe = (await response.text()).slice(0, 300);
      throw new DomainException(`Falha ao enviar a foto para o armazenamento. Status=${response.status}. Detalhe=${detalhe}`);
    }

    return `${this.baseUrl}/storage/v1/object/public/${destino}`;
  }
}
