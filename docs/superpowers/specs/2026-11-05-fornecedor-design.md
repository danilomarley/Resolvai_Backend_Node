# Integração do fornecedor

Escopo aprovado pelo usuário: backend em `feat/migrar-fornecedor`, baseado na `main` local; frontend em `feat/ajustar-cadastro`, baseado na `dev` local. Preservar a mudança anterior que moveu o frontend à raiz.

Migrar o cadastro PF/PJ, especialidades e consulta do fornecedor do backend C# (`a6c56d6b8544c53bae33e08c5a98854af0aa2417`) para a arquitetura atual Fastify/TypeScript/pg. Integrar cadastro, login e leitura/edição do perfil React. Senhas ficam no Supabase Auth; dados básicos em users, profissionais em fornecedores, telefone em contatos e vínculos em fornecedor_especialidades.

Usar o backend existente e o contrato C#, pois o usuário pediu explicitamente esse fluxo. Acesso direto ao banco pelo navegador e novo backend independente não atendem a esse requisito.

Corrigir o fallback de identidade por e-mail, o reset público de senha sem prova de posse e a unicidade de CPF sem papel. Nunca autorizar por metadados editáveis. Proteger as operações do fornecedor por UUID, papel Prestador, conta ativa e existência do perfil.

Cadastro PF exige CPF válido; PJ exige CNPJ numérico ou alfanumérico válido e CPF nulo. Especialidades devem existir e estar ativas; UF brasileira e raio de 1 a 200 km. Conta profissional usa e-mail/UUID próprios. Gravações locais do cadastro e da edição devem ser transacionais; Auth e PostgreSQL não são uma transação distribuída. Tratar retomada sem redefinir/apagar contas externas.

O perfil pode editar nome básico, nome de exibição, telefone, cidade, UF, raio, bio, registro e especialidades. E-mail, documentos e tipo de pessoa ficam somente leitura. A resposta agrega dados básicos e profissionais para evitar valores fictícios nas telas de conta. As métricas, oportunidades e propostas existentes permanecem fora da integração.

Não implementar documentos digitalizados, portfólio, oportunidades, propostas ou aprovação manual. Remover a exigência de uploads e a mensagem de análise do cadastro; comunicar sucesso real e eventual confirmação de e-mail.

Não modificar o Supabase remoto nem cadastrar pessoas reais durante testes. Seu esquema já contém as tabelas profissionais e UNIQUE(cpf, role). Versionar referências SQL com numeração livre, sem reaplicar mudanças remotas automaticamente. Testar com PostgreSQL em memória e Auth simulado apenas na fronteira externa.

Sessão do navegador deve expirar/renovar, respeitar Lembrar acesso e ser removida ao sair ou ao receber recusa de autenticação. Backend continua protegendo dados independentemente do controle de navegação do frontend. Nunca guardar senha ou incluir chaves privilegiadas no frontend.
