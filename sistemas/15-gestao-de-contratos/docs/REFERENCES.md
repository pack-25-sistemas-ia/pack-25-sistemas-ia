# REFERENCES — Gestão de Contratos e Vencimentos

Pesquisa de soluções abertas **antes** de construir. Licença, versão e popularidade foram **consultadas em 2026-10-19** (API do GitHub e `npm view`); o que não foi verificado não aparece. Nenhum código de terceiros foi copiado: as decisões abaixo são sobre **ideias** e **dependências**.

| Projeto | Licença | Versão / popularidade (2026-10-19) | O que oferece | Decisão |
|---|---|---|---|---|
| [Documenso](https://github.com/documenso/documenso) | AGPL-3.0 | v2.21.0 · 15.478 estrelas · ativo | Assinatura eletrônica de documentos (envio, assinatura, trilha) | **Estudar (só conceito).** AGPL-3.0 não pode ser incorporada a um produto distribuído sem copyleft de rede, e **assinatura eletrônica/certificada está fora do escopo** deste sistema. Ideia usada (decisão nossa): cada documento tem versões imutáveis e uma trilha de eventos. |
| [DocuSeal](https://github.com/docusealco/docuseal) | AGPL-3.0 | 3.3.3 · 18.752 estrelas · ativo | Formulários e assinatura de PDF | **Estudar (só conceito).** Mesma restrição de licença e de escopo. Reforça manter o contrato como *arquivo + metadados*, sem editor de documento. |
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | GPL-3.0 | v3.3.3 · 46.889 estrelas · ativo | Arquivo de documentos com OCR, etiquetas e correspondentes | **Estudar (só conceito).** GPL-3.0 incompatível com incorporar código; OCR e busca por conteúdo estão fora do MVP. Ideia usada: «correspondente» → **parte** do contrato, com tipo e papel, e metadados estruturados em vez de pasta. |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT | CLI `shadcn` 4.22.1 · 125.981 estrelas · ativo | Componentes copiáveis (Radix + Tailwind) | **Rejeitar como dependência.** Traria Radix e muitos arquivos para poucos controles; os componentes do Core (Tailwind puro, `<details>`, formulários nativos) bastam e mantêm a CSP estrita. |
| [TanStack Table](https://github.com/TanStack/table) (`@tanstack/react-table`) | MIT | 9.3.1 (npm) · 28.504 estrelas · ativo | Tabelas headless | **Rejeitar.** Filtros, ordenação e paginação são feitos **no servidor** (URL + consulta paginada); a tabela é HTML simples, com cartões no celular. |
| [date-fns](https://github.com/date-fns/date-fns) | MIT (pacote npm) | 4.4.0 (npm) · 36.647 estrelas · ativo | Funções de data | **Rejeitar.** As poucas contas de data (soma de meses com fim de mês limitado, dias entre datas, grade do calendário) trabalham com texto `AAAA-MM-DD` — sem hora nem fuso — e são **espelhadas no banco**; código próprio de ~50 linhas, testado com os mesmos casos nos dois lados, evita um segundo comportamento de fuso/horário de verão. |

Observação: a API do GitHub não informa a licença do date-fns; a licença MIT vem do pacote no npm (`npm view date-fns license`).

## O que ficou de cada estudo
- **Versões de documento** que nunca se apagam (a «atual» é um ponteiro) e **trilha de eventos** — dos sistemas de assinatura.
- **Partes** como entidade própria, reutilizável entre contratos — dos gerenciadores de documentos.
- **Nada de assinatura, OCR ou editor** no MVP: a decisão está em `docs/DECISIONS.md` (D-02).
