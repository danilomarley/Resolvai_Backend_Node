import { createHash, randomUUID } from 'node:crypto';
import type { CurrentUser, IArmazenamentoFotos } from '../contracts.js';
import type { ArquivoPortfolio, CriarProposta, IPropostaRepository, PropostaEnviada } from '../dtos/propostas.js';
import { ConflictException, NotFoundException, ServicoIndisponivelException } from '../errors.js';
import { DomainException } from '../../domain/errors.js';
import type { FornecedorService } from './fornecedor-service.js';

export interface ArmazenamentoPortfolio extends IArmazenamentoFotos { remover(caminhos: string[]): Promise<void>; }
export class PropostaService {
  constructor(private readonly fornecedores: FornecedorService, private readonly repository: IPropostaRepository, private readonly storage: ArmazenamentoPortfolio) {}

  async get(current: CurrentUser, orderId: string, id: string) {
    const profile = await this.fornecedores.getCurrent(current);
    const result = await this.repository.find(id);
    if (!result || result.providerId !== profile.idUsuario || result.proposal.orderId !== orderId) throw new NotFoundException('Proposta', id);
    return result.proposal;
  }

  async create(current: CurrentUser, orderId: string, data: CriarProposta, files: ArquivoPortfolio[]): Promise<PropostaEnviada> {
    const profile = await this.fornecedores.getCurrent(current);
    if (files.length > 5) throw new DomainException('Envie no máximo 5 fotos.');
    const extensions = files.map(file => {
      if (!file.conteudo.length || file.conteudo.length > 5 * 1024 * 1024) throw new DomainException('Cada foto deve ter até 5 MB e não pode estar vazia.');
      const png = file.conteudo.length > 8 && file.conteudo.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpg = file.conteudo.length > 3 && file.conteudo[0] === 255 && file.conteudo[1] === 216 && file.conteudo[2] === 255;
      if ((png && file.contentType === 'image/png') || (jpg && file.contentType === 'image/jpeg')) return png ? 'png' : 'jpg';
      throw new DomainException('Envie apenas fotos JPG ou PNG válidas.');
    });
    const hash = createHash('sha256').update(JSON.stringify({ orderId, data, files: files.map(file => ({ name: file.name, type: file.contentType, hash: createHash('sha256').update(file.conteudo).digest('hex') })) })).digest('hex');
    const existing = await this.repository.find(data.requestId);
    if (existing) {
      if (existing.providerId !== profile.idUsuario || existing.proposal.orderId !== orderId || existing.payloadHash !== hash) throw new ConflictException('Identificador de envio já utilizado para outra proposta.');
      return existing.proposal;
    }
    await this.repository.assertAvailable(orderId, profile.idUsuario);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    if (data.startDate && data.startDate < today) throw new DomainException('A data de início não pode estar no passado.');
    const attemptedPaths: string[] = [];
    const portfolio: PropostaEnviada['portfolio'] = [];
    let committed = false;
    let writeStarted = false;
    let cleanupAllowed = true;
    try {
      const attempt = randomUUID();
      for (const [index, file] of files.entries()) {
        const path = `propostas/${profile.idUsuario}/${data.requestId}/${attempt}/${index}.${extensions[index]}`;
        attemptedPaths.push(path);
        let url: string;
        try { url = await this.storage.enviar(path, file.conteudo, file.contentType); }
        catch { throw new ServicoIndisponivelException('Não foi possível enviar as fotos. Tente novamente com os mesmos dados.'); }
        portfolio.push({ url, name: file.name });
      }
      writeStarted = true;
      const result = await this.repository.create(orderId, profile.idUsuario, data, hash, portfolio);
      committed = result.created;
      return result.proposal;
    } catch (error) {
      if (writeStarted && !(error instanceof DomainException || error instanceof ConflictException || error instanceof NotFoundException)) {
        // A lost COMMIT response may already have persisted the proposal. Never delete those photos.
        cleanupAllowed = false;
        const saved = await this.repository.find(data.requestId).catch(() => null);
        if (saved?.providerId === profile.idUsuario && saved.proposal.orderId === orderId && saved.payloadHash === hash) return saved.proposal;
        throw new ServicoIndisponivelException('Não foi possível confirmar o envio. Tente novamente com os mesmos dados para verificar a proposta.');
      }
      throw error;
    } finally {
      // Only this attempt's unreferenced files can be removed. Never remove another retry's photos.
      if (cleanupAllowed && !committed && attemptedPaths.length) await this.storage.remover(attemptedPaths).catch(() => {});
    }
  }
}
