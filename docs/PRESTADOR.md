# App do prestador: rotas e scripts SQL

Rotas usadas pelo app do prestador ([Resolvai_Prestador](https://github.com/danilomarley/Resolvai_Prestador), escopo em `ESCOPO.md`) e o aceite de proposta do contratante ([Resolvai_Cliente#84](https://github.com/danilomarley/Resolvai_Cliente/issues/84)).

## Banco de dados: carregar antes de usar

Rode **nesta ordem** no SQL Editor do Supabase (cada script é idempotente e pode ser repetido):

| Script | O que faz |
| --- | --- |
| `014_alter_propostas_data_e_prazo.sql` | `propostas.data_criacao` e `propostas.prazo_dias` (já exigido pela versão anterior da API). |
| `015_create_categorias_servico.sql` | Função `resolvai_norm`, tabela `categorias_servico` e **a primeira lista de categorias** (carga inicial no fim do arquivo; edite à vontade). |
| `016_create_perfil_prestador.sql` | `prestador_categorias` e `prestador_regioes` (perfil profissional). |
| `017_alter_propostas_status_e_unicidade.sql` | Status `nao_escolhida`, uma proposta por prestador e pedido, uma proposta escolhida por pedido. |

`db/aplicar-prestador.sql` junta os scripts 015, 016 e 017 em um arquivo só, para colar de uma vez. Sem eles as rotas `/api/v1/provider/*` e `/api/v1/catalog/*` respondem 500; o restante da API não depende deles.

## Cadastro

`POST /api/v1/auth/register-provider` (público) recebe o cadastro completo de fornecedor PF/PJ, documento correspondente, contato, especialidades e cidades de atuação. Cliente mantém cadastro simples em `/api/v1/auth/register`. O fornecedor nasce com papel `Prestador`; PJ usa CNPJ e pode concluir o perfil sem CPF. O corpo simples antigo não atende ao novo contrato. Consulte [cadastro profissional](PROVIDER-REGISTRATION.md).

Categorias e cidades de `/provider/profile` são sincronizadas com `/fornecedores/me`. Para atualizar o banco existente, use a [migração de conciliação](CONCILIACAO-PR8.md), em vez de reaplicar indiscriminadamente os scripts históricos acima.

## Rotas do prestador

Todas exigem o papel `Prestador` (403 para os demais), `Cache-Control: no-store`, e usam `ProblemDetails` nos erros.

| Método e rota | Descrição |
| --- | --- |
| `GET /api/v1/catalog/categories` | Catálogo de categorias (qualquer usuário autenticado). |
| `GET` · `PUT /api/v1/provider/profile` | Categorias e cidades de atuação. `PUT` substitui tudo: `{ "categoryIds": [...], "cities": [...] }`, ao menos uma de cada. `onboardingComplete` = cadastro finalizado + categoria + cidade. |
| `GET /api/v1/provider/summary` | Indicadores: pedidos novos (24 h), pedidos compatíveis abertos e propostas por status. |
| `GET /api/v1/provider/orders` | Feed de pedidos abertos **sem proposta escolhida**. Filtros: `category` (slug), `city`, `urgency`, `q`, `compatible=true`, `page`, `pageSize`. Compatíveis primeiro, depois os mais recentes. |
| `GET /api/v1/provider/orders/{id}` | Detalhe. Visível enquanto o pedido está aberto, ou depois para quem enviou proposta; senão 404. `open` diz se ainda recebe propostas. |
| `POST /api/v1/provider/orders/{id}/proposals` | Envia proposta: `value`, `deadlineDays` (1 a 365), `description` (10 a 2000), `warranty` (3 a 200, obrigatória). 409 se o pedido não recebe mais propostas ou já há proposta deste prestador. |
| `GET /api/v1/provider/proposals` | Minhas propostas, com `status` (`Sent`, `Viewed`, `Chosen`, `NotChosen`), `q` e paginação; a resposta traz `counts` por status. |
| `GET` · `PATCH` · `DELETE /api/v1/provider/proposals/{id}` | Detalhe, edição e retirada. Só enquanto `Sent` ou `Viewed` e o pedido aberto; senão 409. Retirar apaga a proposta e permite propor de novo. |

### Compatibilidade

Um pedido é **compatível** com o prestador quando (1) a categoria do pedido (`escopo.categoria`) é igual, sem acento nem maiúsculas, a uma categoria do prestador **e** (2) a localização do pedido (`escopo.localizacao`) contém o nome de alguma cidade do prestador. Pedidos não compatíveis continuam no feed, sem destaque.

Enviar proposta exige compatibilidade e pedido de outro usuário, aberto e sem proposta escolhida. A localização atual é textual; o raio em quilômetros não calcula distância geográfica.

### Privacidade do contratante

O prestador vê do contratante **só o primeiro nome**. Endereço completo, telefone, e-mail e CPF nunca saem nestas rotas.

## Aceite de proposta (contratante)

`POST /api/v1/orders/{id}/proposals/{proposalId}/accept` marca a proposta como `Chosen` e as demais pendentes do pedido como `NotChosen`. O pedido **continua `Pending`**: ele só entra em andamento depois do pagamento. Responde com o pedido atualizado. 409 quando o pedido não está mais aberto, já tem proposta aceita ou a proposta não está disponível; 404 para inexistentes ou de outro usuário.

Na Home do contratante, `proposals.awaitingDecision` passa a contar só propostas ainda pendentes (`Sent` ou `Viewed`) em pedidos abertos.
