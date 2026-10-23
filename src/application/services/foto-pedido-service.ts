import { randomUUID } from 'node:crypto';
import { UserRole } from '../../domain/enums.js';
import { DomainException } from '../../domain/errors.js';
import type { CurrentUser, IArmazenamentoFotos, IUserRepository } from '../contracts.js';
import type { FotoEnviadaResponse } from '../dtos/fotos.js';
import { UnauthorizedException } from '../errors.js';

export const tamanhoMaximoFoto = 5 * 1024 * 1024;

const formatos = [
  { tipo: 'image/jpeg', extensao: 'jpg', assinatura: (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    tipo: 'image/png',
    extensao: 'png',
    assinatura: (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  {
    tipo: 'image/webp',
    extensao: 'webp',
    assinatura: (b: Buffer) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
  }
];

export interface ArquivoEnviado {
  conteudo: Buffer;
  contentType: string;
}

/**
 * Envio das fotos que acompanham o pedido. A foto vai para o Storage antes da criação do pedido,
 * e a URL devolvida entra em fotos[] de POST /api/v1/orders.
 */
export class FotoPedidoService {
  constructor(
    private readonly armazenamento: IArmazenamentoFotos,
    private readonly userRepository: IUserRepository
  ) {}

  async enviar(currentUser: CurrentUser, arquivo: ArquivoEnviado): Promise<FotoEnviadaResponse> {
    if (!currentUser.isAuthenticated || !currentUser.id) {
      throw new UnauthorizedException('Token sem identificação de usuário.');
    }

    const user = await this.userRepository.getById(currentUser.id);
    if (!user || !user.cpf?.trim()) {
      throw new DomainException('Finalize o cadastro antes de enviar fotos.');
    }

    if (user.role !== UserRole.Cliente) {
      throw new DomainException('Apenas clientes podem enviar fotos de pedidos.');
    }

    if (arquivo.conteudo.length === 0) {
      throw new DomainException('A foto enviada está vazia.');
    }

    if (arquivo.conteudo.length > tamanhoMaximoFoto) {
      throw new DomainException('A foto deve ter no máximo 5 MB.');
    }

    // O tipo é conferido pelo conteúdo, não só pelo Content-Type informado pelo navegador.
    const formato = formatos.find(item => item.assinatura(arquivo.conteudo));
    if (!formato || formato.tipo !== arquivo.contentType.toLowerCase()) {
      throw new DomainException('Envie uma foto JPG, PNG ou WEBP.');
    }

    const caminho = `${user.id}/${randomUUID()}.${formato.extensao}`;
    const url = await this.armazenamento.enviar(caminho, arquivo.conteudo, formato.tipo);

    return { url };
  }
}
