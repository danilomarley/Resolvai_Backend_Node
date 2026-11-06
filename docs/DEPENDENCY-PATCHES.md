# Atualizações de segurança de dependências

Revisão de 2026-11-06, separada das funcionalidades da Sprint 4.

O `npm audit --omit=dev` inicial apontou seis entradas: Zod (alta), Fastify
(baixa), fast-uri e a cadeia @fastify/static/glob/minimatch (moderadas).

Foram atualizadas somente versões compatíveis: Fastify 5.12.6, Zod 4.6.6,
fast-uri 3.1.9, @fastify/static 10.1.10, glob 14.0.4 e minimatch 11.0.5.
O arquivo de lock mantém as resoluções transitivas. Não foram adicionados
overrides nem alterados contratos da aplicação.

Após as atualizações, `npm audit --omit=dev` e a auditoria completa retornam
zero vulnerabilidades conhecidas. Isso descreve o banco de advisories consultado,
sem substituir a revisão da aplicação. Validação: 64 testes aprovados,
typecheck e build. Nenhuma dependência do frontend foi alterada nesta PR.
