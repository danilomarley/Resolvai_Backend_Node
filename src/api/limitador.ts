import { MuitasTentativasException } from '../application/errors.js';

/**
 * Limite simples de tentativas por chave (IP, e-mail ou usuário) numa janela de tempo, em memória.
 * Vale por instância da API: suficiente para o deploy atual, que roda uma instância só.
 */
export class LimitadorDeTentativas {
  private readonly tentativas = new Map<string, number[]>();

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
    private readonly agora: () => number = Date.now
  ) {}

  registrar(chave: string, mensagem?: string): void {
    const agora = this.agora();
    const recentes = (this.tentativas.get(chave) ?? []).filter(instante => agora - instante < this.janelaMs);

    if (recentes.length >= this.maximo) {
      this.tentativas.set(chave, recentes);
      throw new MuitasTentativasException(mensagem);
    }

    recentes.push(agora);
    this.tentativas.set(chave, recentes);

    if (this.tentativas.size > 10_000) {
      this.limpar(agora);
    }
  }

  private limpar(agora: number): void {
    for (const [chave, instantes] of this.tentativas) {
      if (instantes.every(instante => agora - instante >= this.janelaMs)) {
        this.tentativas.delete(chave);
      }
    }
  }
}
