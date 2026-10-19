# PERMISSIONS — Gestão de Projetos e Tarefas

## Dois níveis
1. **Perfil na empresa** (vem do Core): Proprietário/Admin → *proprietário*; Gerente → *gestor*; Membro → *colaborador*; Leitor → *leitor*.
2. **Papel no projeto** (`project_members`): *líder*, *editor*, *leitor*.

Gestor e proprietário agem como **líder em todos os projetos** da empresa (sem linha em `project_members`). Colaborador só tem o papel que recebeu, e só nos projetos em que participa. O *leitor* da empresa só pode ser *leitor* nos projetos (o banco recusa outro papel).

## Matriz (projeto em estado que aceita a ação)
| Ação | Proprietário | Gestor | Líder | Editor | Leitor de projeto |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver projeto, tarefas, comentários, anexos, histórico | ✅ todos | ✅ todos | ✅ | ✅ | ✅ |
| Criar projeto | ✅ | ✅ | — | — | — |
| Editar projeto, mudar status, arquivar, gerir participantes e etapas | ✅ | ✅ | ✅ | — | — |
| Criar/editar/mover tarefas, checklist, etiquetas, impedimento | ✅ | ✅ | ✅ | ✅ | — |
| Atribuir tarefa (só a líder/editor/gestão) | ✅ | ✅ | ✅ | ✅ | — |
| Arquivar tarefa; editar/remover etiqueta | ✅ | ✅ | ✅ | — | — |
| Comentar e anexar | ✅ | ✅ | ✅ | ✅ | — |
| Configurações da empresa (marca, fuso, prefixo, anexos) | ✅ | — | — | — | — |
| «Minhas tarefas» (recebe tarefas) | ✅ | ✅ | ✅ | ✅ | não (404) |
| Painel e CSV | tudo | tudo | só os projetos que vê | só os que vê | só os que vê |

## Por estado do projeto
| Estado | Organizar (criar, editar, mover entre etapas do mesmo tipo, etiquetas…) | Executar (mudar o tipo da etapa: iniciar, revisar, concluir) | Comentar/anexar |
|---|:-:|:-:|:-:|
| Planejado | ✅ | — | ✅ |
| Ativo | ✅ | ✅ | ✅ |
| Pausado | ✅ | — | ✅ |
| Concluído · Cancelado · Arquivado | — | — | — (somente consulta) |

Transições: planejado→ativo/cancelado; ativo→pausado/concluído/cancelado; pausado→ativo/cancelado; concluído/cancelado→ativo (**reabrir**: líder, motivo ≥ 5 caracteres). Arquivar: só concluído/cancelado. Concluir: zero tarefas abertas.

## Regras de tarefa
- Concluir exige todos os itens **obrigatórios** do checklist marcados; reabrir limpa a data de conclusão.
- Impedimento exige motivo e não é um estado: a tarefa continua na etapa em que está.
- Arquivar tarefa não concluída exige motivo (≥ 5 caracteres); arquivada é somente consulta.
- Quem perde o acesso ao projeto (saiu da empresa, virou leitor, foi removido) tem as tarefas abertas **desatribuídas** (ou transferidas por quem o removeu) com evento no histórico.

Todas essas regras são impostas **no banco**; a interface apenas esconde o que a pessoa não pode fazer.
