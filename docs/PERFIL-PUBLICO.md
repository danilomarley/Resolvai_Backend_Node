# Perfil público (#93) — entrega parcial

`GET /api/v1/providers/{id}/public-profile` exige sessão de cliente e proposta desse prestador em um pedido do cliente. Retorna 404 também para prestador inativo ou sem essa relação. O Swagger documenta o contrato.

Campos: `id`, `name`, `photoUrl`, `categories`, `region`, `completedServices`, `reviewsAvailable`, `reviewsCount`, `averageRating`, `reviews`. reviewsCount é a quantidade total recebida pelo prestador (null se a fonte estiver ausente, zero se disponível e sem avaliações). Média e contagem usam todo o histórico; a lista contém somente as cinco mais recentes. Cada avaliação contém apenas rating, comment? e createdAt. Não publica CPF, CNPJ, telefone, e-mail, endereço residencial nem identificador de cliente/pedido.

Fontes verificadas:

- Main Node: `users.name`, `pedidos.status` e `propostas.status` fornecem nome e contagem de pedidos concluídos com proposta escolhida. Propostas legadas repetidas não duplicam a contagem.
- [Cadastro profissional C#](https://github.com/danilomarley/Resolvai_Backend/blob/a6c56d6/docs/PROVIDER-REGISTRATION.md): `fornecedores.nome_exibicao`, `cidade_atuacao`, `uf_atuacao`, `fornecedor_especialidades` e `especialidades`. As tabelas só são consultadas quando todas existem. Sem elas, categorias e região são null; não se usa o endereço privado. Nenhuma migration da outra equipe é instalada ou reaplicada.
- [PR de avaliações #2](https://github.com/danilomarley/Resolvai_Backend_Node/pull/2): tabela `avaliacoes`. Sem a tabela, `reviewsAvailable=false` indica indisponibilidade. Com a tabela e sem avaliações, a média é null e `reviewsAvailable=true`. A média considera todo o histórico, a lista contém até cinco registros recentes.

Pendências que impedem concluir #93:

1. Foto: nenhum campo ou contrato profissional foi encontrado. `photoUrl` é null até definir a fonte pública com a outra equipe (#53).
2. Categorias/região: confirmar disponibilidade do esquema profissional em ambiente isolado compartilhado; ele não está nas migrations da main Node.
3. Avaliações: integrar a #92 e aplicar sua migration.
4. Comparação: a tela #87 não está na main do frontend; a navegação por ela ainda não existe.

A revisão também consultou Resolvai_Documentacao/VisualizacaoPrototipo/documentação.md, os protótipos de fornecedor e PRODUCT_BACKLOG.md. São especificações/protótipos sem backend de avatares; iniciais e imagens do protótipo não constituem fonte legítima. O cadastro Node existente só envia name ao Auth e não tem upload/contrato de avatar. A #53 permanece sem contrato adicional e a #87 continua aberta. Nenhuma foto é inferida de metadados privados do Auth.

A branch parte de origin/main sem commits da #92. Testes: `npm run typecheck`, `npm test` (66 aprovados), `npm run build`. A integração usa PGlite e driver pg, testando a main sem fontes opcionais e uma fixture somente das colunas consultadas dos contratos acima. Essa fixture não é migration de produção. Cobre autorização, privacidade, categorias ativas, média, limite de cinco avaliações, contagem sem duplicidade e Swagger.
