# Pedidos e resumo da Home

As rotas leem as tabelas `public.pedidos`, `public.propostas` e `public.fotos_pedido` (scripts 006 a 008) e `public.users` (nome do prestador). Antes de usá-las, aplique os scripts de `db/scripts` em ordem numérica, incluindo `011_create_ix_pedidos_cliente_criacao.sql` (índice da listagem).

O antigo `003_create_orders.sql` foi removido: as rotas não usam mais `public.orders`. Se essa tabela foi criada em algum banco, ela pode ser descartada pelo responsável depois de conferir que não há dados a migrar.

A conexão do backend deve usar o proprietário das tabelas ou um papel de servidor com permissão de leitura. Não use esse acesso no frontend.

## Código

Os nomes seguem a API C# para facilitar a comparação. Os campos do JSON e os valores de status continuam em inglês porque formam o contrato já consumido pelo front.

| Camada | Arquivos |
| --- | --- |
| Domain | `src/domain/enums.ts` (`StatusPedido`, `StatusProposta`) |
| Application | `src/application/services/pedido-service.ts` (`PedidoService`), `src/application/contracts.ts` (`IPedidoQueries`, `IPedidoRepository`), `src/application/dtos/pedidos.ts` e `home.ts` (schemas zod de `CriarPedidoRequest`, `ListarPedidosQuery`, `PedidoResumoResponse`, `PedidoResponse`, `ResumoHomeResponse`...) |
| Infrastructure | `src/infrastructure/repositories/pedido-queries.ts` (`PedidoQueries`), `pedido-repository.ts` (`PedidoRepository`) |
| Api | `src/api/routes/pedidos-routes.ts` (`/api/v1/orders`), `home-routes.ts` (`/api/v1/home`) |

## Rotas

| Método | Rota | Resposta | Issue |
| --- | --- | --- | --- |
| POST | `/api/v1/orders` | Cria um pedido para o cliente autenticado | Resolvai_Cliente#51 |
| GET | `/api/v1/orders?status=&page=1&pageSize=10` | Lista paginada dos pedidos do usuário (Seus Pedidos) | Resolvai_Cliente#49 |
| GET | `/api/v1/orders/{id}` | Detalhe de um pedido com escopo, fotos e propostas | Resolvai_Cliente#49 |
| GET | `/api/v1/home/summary` | Dados dos cards e os 5 pedidos mais recentes | Resolvai_Cliente#50 |

Todas exigem `Authorization: Bearer <accessToken>` obtido no login. Todos os papéis, inclusive Admin, consultam apenas os pedidos em que são o cliente (`pedidos.id_cliente`). O identificador do usuário vem do token, nunca de parâmetros enviados pelo cliente. Usuários inativos ou tokens inválidos recebem 401. As respostas HTTP não devem ser armazenadas em cache (`Cache-Control: no-store`). Campos nulos são omitidos, conforme a configuração geral da API.

### Status

| Banco (`pedidos.status`) | API |
| --- | --- |
| `aberto` | `Pending` |
| `em_andamento` | `InProgress` |
| `concluido` | `Completed` |
| `cancelado` | `Cancelled` |

| Banco (`propostas.status`) | API |
| --- | --- |
| `enviada` | `Sent` |
| `visualizada` | `Viewed` |
| `escolhida` | `Chosen` |

### Conteúdo esperado em `pedidos.escopo`

Título, categoria, descrição e localização não são colunas: vêm do `jsonb` `escopo`. A rota de criação de pedido (Resolvai_Cliente#51) deve gravar estas chaves:

```json
{
  "titulo": "Infiltração na laje do quarto",
  "categoria": "Impermeabilização",
  "descricao": "A umidade aparece depois de chuvas.",
  "localizacao": "Aldeota, Fortaleza",
  "detalhes": "Mancha de 1 m² no canto do quarto",
  "urgencia": "Nos próximos dias",
  "especificacoes": "Inspeção, preparação da superfície e manta"
}
```

Sem `titulo`, o título passa a ser a `categoria`; sem ambos, `"Pedido"`. Sem `descricao`, a descrição é `""`. As fotos ficam em `fotos_pedido`, não no escopo. O detalhe devolve o `escopo` completo em `scope`, inclusive chaves extras.

## GET /api/v1/orders

Parâmetros de query, todos opcionais:

| Parâmetro | Padrão | Regra |
| --- | --- | --- |
| `status` | todos | `Pending`, `InProgress`, `Completed` ou `Cancelled` |
| `page` | 1 | inteiro ≥ 1 |
| `pageSize` | 10 | inteiro entre 1 e 50 |

Valores inválidos retornam 400 (`ValidationProblemDetails`). Uma página além da última retorna `items` vazio com os totais preenchidos. A ordenação é por `createdAt` decrescente, com desempate por `id`.

```json
{
  "items": [
    {
      "id": "10000000-0000-0000-0000-000000000002",
      "title": "Reparo hidráulico no banheiro",
      "category": "Hidráulica",
      "location": "Meireles, Fortaleza",
      "status": "InProgress",
      "createdAt": "2026-10-06T14:00:00Z",
      "updatedAt": "2026-10-08T14:00:00Z",
      "proposalsCount": 2,
      "chosenProposalValue": 1100.50
    }
  ],
  "page": 1,
  "pageSize": 10,
  "totalItems": 1,
  "totalPages": 1
}
```

`location` vem de `escopo.localizacao` e é omitido quando não foi informado. `proposalsCount` conta todas as propostas recebidas pelo pedido. `chosenProposalValue` é o valor da proposta com status `escolhida` e é omitido enquanto nenhuma foi escolhida.

## POST /api/v1/orders

Cria um pedido com status `aberto` (`Pending` na API) para o usuário do token e devolve o detalhe, com 201 e o cabeçalho `Location` apontando para `GET /api/v1/orders/{id}`.

| Campo | Regra |
| --- | --- |
| `categoria` | obrigatório, até 80 caracteres |
| `descricao` | obrigatório, de 10 a 2000 caracteres |
| `localizacao` | obrigatório, de 3 a 200 caracteres |
| `titulo` | opcional, até 90 caracteres |
| `detalhes`, `especificacoes` | opcionais, até 2000 caracteres |
| `urgencia` | opcional, até 40 caracteres |
| `fotos[]` | opcional, até 4 itens com `url` (obrigatória) e `descricao` |

As chaves de texto vão para `pedidos.escopo` e cada foto vira uma linha em `fotos_pedido`, na mesma transação do pedido. O arquivo da foto não passa pela API: o front envia a imagem ao storage e manda só a URL.

Retorna 400 quando o corpo é inválido, quando o cadastro ainda não foi finalizado (sem CPF) ou quando o usuário não é Cliente.

## POST /api/v1/orders/photos

Envia uma foto antes de criar o pedido (#67). O corpo é `multipart/form-data` com o arquivo no campo `foto`: JPG, PNG ou WEBP, até 5 MB, uma foto por requisição. O tipo é conferido pelo conteúdo do arquivo, não só pelo `Content-Type`. Exige cadastro finalizado e papel Cliente.

A API grava em `{bucket}/{id do usuário}/{uuid}.{ext}` no Supabase Storage (bucket `pedidos`, criado pelo script 012) e responde 201 com `{ "url": "..." }`. Essa URL vai em `fotos[].url` de `POST /api/v1/orders` (até 4 fotos).

## POST /api/v1/orders/assistant

Chat com IA da tela "Criar pedido" (#69). A API não guarda histórico: o front envia a conversa inteira em `messages` (`role` `user` ou `assistant`, até 30 mensagens de até 2000 caracteres, começando e terminando com `user`).

```json
{
  "reply": "Em qual bairro e cidade fica o imóvel?",
  "scope": { "categoria": "Impermeabilização", "descricao": "Pinga água do teto do banheiro quando chove." },
  "complete": false
}
```

`scope` usa as mesmas chaves do corpo de `POST /api/v1/orders` e omite o que ainda não foi informado; `urgencia` só aparece com um dos valores do formulário (`Urgente`, `Nos próximos dias`, `Pode esperar`). `complete` fica `true` quando categoria, descrição e localização já foram informadas. O pedido só é criado quando o cliente confirma o formulário.

O assistente usa a API do Claude (`ANTHROPIC_API_KEY`, modelo `ANTHROPIC_MODEL`, padrão `claude-opus-5-5`). Sem chave, ou com o serviço indisponível, a rota responde 503. Cada usuário pode enviar até 30 mensagens a cada 10 minutos.

## GET /api/v1/orders/{id}

Retorna os campos da listagem, exceto os dois de propostas, e acrescenta:

| Campo | Origem |
| --- | --- |
| `description` | `escopo.descricao` (sempre presente, `""` se ausente) |
| `location` | `escopo.localizacao` |
| `scope` | `escopo` completo, como JSON |
| `photos[]` | `fotos_pedido`: `id`, `url` (valor da coluna `foto`, URL ou caminho no storage), `description` |
| `proposals[]` | `propostas` + `users`: `id`, `providerId`, `providerName`, `status`, `value`, `deadline`, `description`, `warranty` |

As propostas vêm com a escolhida primeiro, depois por valor crescente. Consultar o detalhe não marca propostas como visualizadas. Pedido inexistente ou de outro usuário retorna 404, assim como um identificador que não seja UUID.

## GET /api/v1/home/summary

Mantém o contrato anterior (`orders.total/pending/inProgress/completed/cancelled` e `recentOrders`) e acrescenta os dados dos cards:

```json
{
  "orders": {
    "total": 8,
    "pending": 4,
    "inProgress": 2,
    "completed": 1,
    "cancelled": 1,
    "active": 6,
    "createdLast7Days": 5
  },
  "proposals": {
    "total": 6,
    "awaitingDecision": 3,
    "unviewed": 2
  },
  "recentOrders": []
}
```

| Campo | Significado |
| --- | --- |
| `orders.active` | `pending + inProgress` (card "Pedidos ativos") |
| `orders.createdLast7Days` | pedidos criados nos últimos 7 dias, pelo relógio do banco ("novos nesta semana") |
| `proposals.total` | todas as propostas recebidas nos pedidos do usuário |
| `proposals.awaitingDecision` | propostas em pedidos `Pending`, que ainda aguardam escolha ("Propostas recebidas") |
| `proposals.unviewed` | dessas, as que estão com status `enviada` ("propostas para conferir") |

Cada item de `recentOrders` tem o mesmo formato dos itens de `GET /api/v1/orders`, e a lista é limitada a 5. Os totais consideram todos os pedidos do usuário, independentemente desse limite. Sem pedidos, todos os contadores são zero e a lista vem vazia.

O card "Sua avaliação" do protótipo não tem fonte de dados: não há tabela de avaliações.

## Consultas

As consultas usam parâmetros e timeout (`DATABASE_COMMAND_TIMEOUT_SECONDS`). Cada rota executa suas leituras numa transação curta `REPEATABLE READ`, então contadores, página e listas relacionadas vêm do mesmo snapshot. Os totais são agregados no PostgreSQL, sem carregar os pedidos em memória. O índice `ix_pedidos_cliente_criacao` começa pelo cliente e segue a ordenação da listagem.

## Swagger e validação

Com a API em execução, acesse `/swagger` (local: `http://localhost:5172/swagger`). O documento completo está em `/openapi/v1.json`. Faça login, copie `accessToken` e use **Authorize** no Swagger. Exemplos de requisição estão em `requests.http`.

`npm test` roda os testes de serviço, os testes HTTP e os de integração. Os de integração sobem um PostgreSQL em memória (PGlite) com os scripts de `db/scripts` e cobrem:

1. Sem token ou com usuário inativo, as rotas retornam 401.
2. Sem pedidos, a Home retorna contadores zerados e lista vazia.
3. Com pedidos de dois clientes, cada um vê apenas os próprios na lista, no detalhe e nos totais.
4. Pedido de outro cliente ou UUID inexistente retorna 404.
5. Com mais de cinco pedidos, `recentOrders` tem cinco itens e os totais consideram todos; a lista paginada respeita `page`/`pageSize`/`totalPages`.
6. Cada status aparece no contador e no filtro correspondentes; pedidos com a mesma data de criação são desempatados por `id`.
7. `page=0`, `pageSize=51` e `status` inexistente retornam 400.
