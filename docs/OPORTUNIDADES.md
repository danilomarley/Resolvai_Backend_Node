# Oportunidades do fornecedor

`GET /api/v1/fornecedores/me/oportunidades` lista pedidos reais de `public.pedidos`
para o Prestador ativo identificado pelo Bearer. Exige perfil em `fornecedores`.

As especialidades vêm de `fornecedor_especialidades` e `especialidades`, sempre
consultadas no banco. O cliente não pode informar outro fornecedor ou ampliar
as próprias especialidades por parâmetros da requisição.

Um pedido é elegível quando está `aberto`, não possui proposta `escolhida` e sua
`escopo.categoria` corresponde ao código ou ao nome de uma especialidade ativa
do fornecedor. A comparação ignora maiúsculas, acentos e espaços externos;
códigos com `_` também podem corresponder ao nome com espaços. A comparação é
de categoria inteira, sem inferir que uma categoria genérica como `Reformas`
equivale a Elétrica, Alvenaria ou outra especialidade. A localização textual
precisa conter a cidade principal de `fornecedores.cidade_atuacao`.
Essa comparação não calcula distância pelo raio em quilômetros.
Pedidos do próprio usuário são excluídos.

Parâmetros opcionais: `page` (padrão 1), `pageSize` (1–50, padrão 10), `search`
(busca literal em título, categoria ou localização), `category` (código da
especialidade) e `sort` (`recent` ou `proposals`). A ordenação por data utiliza
UUID como desempate. A ordenação por propostas coloca primeiro os pedidos com
menos propostas. Filtros são aplicados antes da paginação.

A resposta contém `items`, `page`, `pageSize`, `totalItems`, `totalPages` e
`specialties` (códigos e nomes ativos do fornecedor, para montar os filtros).
Cada item contém `id`, `title`, `category`, `specialtyCode`, `createdAt`,
`proposalsCount`, `location` e `urgency` opcionais. Sem resultados, `items` é
vazio e os totais são zero. Os contadores e a página usam o mesmo snapshot.

A listagem obtém itens, contagem e especialidades em uma única instrução SQL.
O detalhe também consulta pedido, cliente/histórico e fotos em uma única instrução.
Cada leitura usa o snapshot da própria instrução, sem abrir uma transação explícita
com múltiplas idas ao banco remoto. Isso preserva os contratos e a elegibilidade,
mas reduz o custo de rede de cada consulta nova, inclusive filtros ainda não vistos.

`GET /api/v1/fornecedores/me/oportunidades/{id}` aplica a mesma elegibilidade e
acrescenta descrição, detalhes, especificações e fotos reais do pedido.
O campo `client` traz somente `name`, `memberSince`, `ordersCount` e
`completedOrdersCount`, para o cartão de informações do cliente. O histórico
é calculado pelos pedidos reais desse cliente, sem inferir avaliações,
verificação de identidade ou situação de pagamentos.
Não retorna contatos ou documentos do cliente, propostas dos concorrentes nem
o JSON arbitrário do escopo. Pedido fora da especialidade, encerrado, atribuído,
inexistente ou UUID inválido retorna 404. Todas as respostas usam `no-store`.

Não há estimativa financeira, nota de IA, métrica de cliente ou região inferida.
O envio de propostas usa as rotas descritas em [PROPOSTAS.md](PROPOSTAS.md),
incluindo a [migração de conciliação](CONCILIACAO-PR8.md) para o banco existente. Os testes usam
PostgreSQL isolado e HTTP simulado.
