import { createHash } from 'node:crypto';

/**
 * Modelo padrão do contrato de prestação de serviços (Resolvai_Cliente#95). Mudou o texto, muda a versão:
 * cada contrato guarda a versão e o hash do texto com que foi assinado.
 */
export const versaoModeloContrato = '2026-11-v1';

export interface ParteContrato {
  nome: string;
  /** CPF ou CNPJ, só dígitos e letras. Aparece mascarado no texto. */
  documento?: string | null;
}

export interface DadosContrato {
  contratante: ParteContrato;
  prestador: ParteContrato;
  pedido: {
    titulo: string;
    categoria?: string | null;
    descricao: string;
    localizacao?: string | null;
    detalhes?: string | null;
    urgencia?: string | null;
    especificacoes?: string | null;
  };
  proposta: {
    valor: number;
    prazo?: string | null;
    garantia?: string | null;
    garantiaCondicoes?: string | null;
    materiais?: string | null;
    dataInicio?: string | null;
    descricao?: string | null;
  };
  geradoEm: Date;
}

/** Mostra só o miolo do CPF/CNPJ: o contrato é visto pela outra parte e não precisa do documento inteiro. */
export function mascararDocumento(documento?: string | null): string {
  const valor = (documento ?? '').replace(/[^0-9A-Za-z]/g, '');
  if (valor.length === 11) {
    return `CPF ***.${valor.slice(3, 6)}.${valor.slice(6, 9)}-**`;
  }

  if (valor.length === 14) {
    return `CNPJ **.***.***/${valor.slice(8, 12)}-**`;
  }

  return 'documento não informado';
}

export function hashDoContrato(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataBr = (data: Date) => data.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });

const dataDoDia = (valor: string) => {
  const [ano, mes, dia] = valor.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
};

const preenchido = (valor?: string | null): string | undefined => valor?.trim() || undefined;

/**
 * Texto integral do contrato. Prazo, garantia e valor vêm da proposta aceita, nunca de valores fixos, para
 * o contrato dizer o mesmo que a proposta.
 */
export function gerarTextoContrato(dados: DadosContrato): string {
  const { contratante, prestador, pedido, proposta } = dados;
  const linhas: string[] = [];
  const adicionar = (...itens: string[]) => linhas.push(...itens);

  adicionar(
    'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
    `Modelo padrão ResolvAI, versão ${versaoModeloContrato}. Gerado em ${dataBr(dados.geradoEm)}.`,
    '',
    'PARTES',
    `CONTRATANTE: ${contratante.nome}, ${mascararDocumento(contratante.documento)}.`,
    `PRESTADOR: ${prestador.nome}, ${mascararDocumento(prestador.documento)}.`,
    'Os dois se identificaram na plataforma ResolvAI, que intermediou esta contratação.',
    '',
    'CLÁUSULA 1 – DO OBJETO',
    `O PRESTADOR executará para o CONTRATANTE o serviço "${pedido.titulo}"${preenchido(pedido.categoria) ? ` (${pedido.categoria!.trim()})` : ''}${preenchido(pedido.localizacao) ? `, no local ${pedido.localizacao!.trim()}` : ''}, conforme o escopo abaixo.`,
    `Descrição do pedido: ${pedido.descricao.trim()}`
  );
  if (preenchido(pedido.detalhes)) adicionar(`Detalhes do ambiente: ${pedido.detalhes!.trim()}`);
  if (preenchido(pedido.especificacoes)) adicionar(`Escopo solicitado: ${pedido.especificacoes!.trim()}`);
  if (preenchido(pedido.urgencia)) adicionar(`Urgência informada: ${pedido.urgencia!.trim()}`);

  adicionar('', 'CLÁUSULA 2 – DA PROPOSTA ACEITA', 'O CONTRATANTE aceitou a proposta do PRESTADOR na plataforma, cujos termos fazem parte deste contrato.');
  if (preenchido(proposta.descricao)) adicionar(`Descrição da proposta: ${proposta.descricao!.trim()}`);
  if (preenchido(proposta.materiais)) adicionar(`Materiais: ${proposta.materiais!.trim()}`);
  if (preenchido(proposta.dataInicio)) adicionar(`Início previsto: ${dataDoDia(proposta.dataInicio!.trim())}.`);

  adicionar(
    '',
    'CLÁUSULA 3 – DO VALOR E DO PAGAMENTO',
    `O valor total do serviço é de ${moeda(proposta.valor)}.`,
    'O pagamento é feito pelo CONTRATANTE na plataforma ResolvAI, por PIX ou cartão. O serviço só começa depois da confirmação do pagamento.',
    'O repasse ao PRESTADOR acontece depois da conclusão do serviço, nos termos da plataforma.',
    '',
    'CLÁUSULA 4 – DO PRAZO',
    `Prazo de execução: ${preenchido(proposta.prazo) ?? 'a combinar entre as partes, por escrito, na plataforma'}, contado a partir da confirmação do pagamento.`,
    '',
    'CLÁUSULA 5 – DA GARANTIA',
    `Garantia do serviço: ${preenchido(proposta.garantia) ?? 'não informada na proposta'}.`
  );
  if (preenchido(proposta.garantiaCondicoes)) adicionar(`Condições da garantia: ${proposta.garantiaCondicoes!.trim()}`);
  adicionar(
    'Durante a garantia, o PRESTADOR corrige sem custo os defeitos do serviço executado, salvo os causados por mau uso ou por terceiros.',
    '',
    'CLÁUSULA 6 – DAS OBRIGAÇÕES DO PRESTADOR',
    'Executar o serviço com qualidade técnica e no prazo combinado; usar materiais adequados; manter o CONTRATANTE informado sobre o andamento; respeitar o local e as normas de segurança; e corrigir os defeitos cobertos pela garantia.',
    '',
    'CLÁUSULA 7 – DAS OBRIGAÇÕES DO CONTRATANTE',
    'Fornecer as informações e o acesso ao local necessários; efetuar o pagamento pela plataforma; e confirmar a conclusão do serviço ou apontar os problemas encontrados.',
    '',
    'CLÁUSULA 8 – DA ALTERAÇÃO E DO CANCELAMENTO',
    'Mudanças de escopo, valor ou prazo só valem se as duas partes concordarem, por escrito, pela plataforma. O cancelamento depois de assinado este contrato segue as regras da plataforma.',
    '',
    'CLÁUSULA 9 – DA PLATAFORMA',
    'A ResolvAI é intermediadora: aproxima as partes, registra este contrato e o pagamento. Ela não executa o serviço nem responde por ele.',
    '',
    'CLÁUSULA 10 – DOS DADOS PESSOAIS',
    'Os dados das partes são usados apenas para esta contratação e tratados conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).',
    '',
    'CLÁUSULA 11 – DA ASSINATURA ELETRÔNICA',
    'As partes assinam por aceite eletrônico em ambiente autenticado. A plataforma registra a data, a hora e o IP de cada assinatura. As partes reconhecem esse aceite como assinatura, nos termos do art. 10, § 2º, da MP 2.200-2/2001.',
    '',
    'CLÁUSULA 12 – DO FORO',
    'Fica eleito o foro da comarca de Fortaleza, Ceará, para resolver qualquer questão deste contrato.'
  );

  return linhas.join('\n');
}
