import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { EscopoSugerido, IAssistentePedido, MensagemChat, RespostaAssistente } from '../../application/contracts.js';
import { ServicoIndisponivelException } from '../../application/errors.js';
import { DomainException } from '../../domain/errors.js';

export interface ClaudeOptions {
  apiKey: string;
  model: string;
}

// Mesmas opções do campo Urgência do formulário de criação de pedido no front.
export const urgencias = ['Urgente', 'Nos próximos dias', 'Pode esperar'] as const;

const system = `Você é o assistente do ResolvAI, um marketplace que conecta clientes a prestadores de serviços residenciais (elétrica, hidráulica, pintura, reformas, impermeabilização, limpeza, montagem etc.).

Seu papel é conversar com o cliente para entender o serviço que ele precisa e montar o pedido que será publicado para os prestadores. Escreva sempre em português do Brasil, com frases curtas e tom cordial.

Como conduzir a conversa:
- Faça uma pergunta por vez, começando pelo que ainda falta para o pedido.
- Para publicar, o pedido precisa de categoria, descrição do problema (ao menos uma frase) e localização (bairro e cidade bastam). Detalhes do ambiente, urgência e especificações do serviço ajudam os prestadores a fazer propostas melhores; pergunte por eles depois do essencial.
- Urgência deve ser uma destas opções: ${urgencias.join(', ')}.
- Use só o que o cliente disse. Não invente medidas, materiais ou endereços.
- Não peça CPF, telefone, e-mail ou endereço completo: esses dados já ficam no cadastro.
- Não estime preços nem recomende prestadores; quem faz isso são as propostas.
- Se o pedido não for um serviço residencial, explique com gentileza que o ResolvAI só atende esse tipo de serviço.

Formato da resposta:
- "resposta": a mensagem que o cliente vai ler.
- "escopo": tudo o que já se sabe do pedido até agora, reunindo a conversa inteira. Use texto vazio para o que ainda não foi informado. "titulo" é um resumo curto do serviço (até 90 caracteres); "descricao" descreve o problema com as palavras do cliente.
- "completo": true quando categoria, descrição e localização estiverem preenchidas.`;

const texto = z.string();

const respostaSchema = z.object({
  resposta: texto,
  escopo: z.object({
    titulo: texto,
    categoria: texto,
    descricao: texto,
    localizacao: texto,
    detalhes: texto,
    urgencia: texto,
    especificacoes: texto
  }),
  completo: z.boolean()
});

const limites: Record<keyof EscopoSugerido, number> = {
  titulo: 90,
  categoria: 80,
  descricao: 2000,
  localizacao: 200,
  detalhes: 2000,
  urgencia: 40,
  especificacoes: 2000
};

/**
 * Assistente de criação de pedidos com a API do Claude (Messages API + saída estruturada).
 * Sem chave configurada, responde 503 e o resto da API segue funcionando.
 */
export class ClaudeAssistentePedido implements IAssistentePedido {
  private readonly client?: Anthropic;

  constructor(private readonly options: ClaudeOptions | undefined) {
    this.client = options ? new Anthropic({ apiKey: options.apiKey }) : undefined;
  }

  async responder(mensagens: MensagemChat[]): Promise<RespostaAssistente> {
    if (!this.client || !this.options) {
      throw new ServicoIndisponivelException('O assistente de pedidos não está configurado neste servidor.');
    }

    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.options.model,
        max_tokens: 16000,
        system,
        messages: mensagens.map(mensagem => ({ role: mensagem.role, content: mensagem.content })),
        // Conversa simples: esforço baixo responde rápido e gasta menos.
        output_config: { effort: 'low', format: betaZodOutputFormat(respostaSchema) },
        // Se o modelo recusar por política de segurança, a própria API tenta de novo em outro modelo.
        // O Haiku não tem esse fallback no servidor, então o parâmetro só vai para os outros modelos.
        ...(this.options.model.startsWith('claude-haiku')
          ? {}
          : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const })
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        throw new ServicoIndisponivelException('O assistente está com muita demanda agora. Tente novamente em instantes.', {
          cause: error
        });
      }

      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ServicoIndisponivelException('O assistente de pedidos não está disponível. Verifique a configuração da chave.', {
          cause: error
        });
      }

      if (error instanceof Anthropic.APIError) {
        throw new ServicoIndisponivelException('O assistente de pedidos está indisponível no momento.', { cause: error });
      }

      throw error;
    }

    if (response.stop_reason === 'refusal') {
      throw new DomainException('O assistente não pode ajudar com essa solicitação. Descreva o serviço residencial que você precisa.');
    }

    const saida = response.parsed_output;
    if (!saida) {
      throw new ServicoIndisponivelException('O assistente não conseguiu montar a resposta. Tente novamente.');
    }

    return {
      resposta: saida.resposta.trim(),
      escopo: limparEscopo(saida.escopo),
      completo: saida.completo
    };
  }
}

/**
 * Remove campos vazios e corta textos nos mesmos limites aceitos por POST /api/v1/orders.
 */
function limparEscopo(escopo: Record<keyof EscopoSugerido, string>): EscopoSugerido {
  const resultado: EscopoSugerido = {};

  for (const chave of Object.keys(limites) as (keyof EscopoSugerido)[]) {
    const valor = escopo[chave]?.trim();
    if (valor) {
      resultado[chave] = valor.slice(0, limites[chave]);
    }
  }

  if (resultado.urgencia && !(urgencias as readonly string[]).includes(resultado.urgencia)) {
    delete resultado.urgencia;
  }

  return resultado;
}
