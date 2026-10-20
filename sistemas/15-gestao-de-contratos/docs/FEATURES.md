# FEATURES — Gestão de Contratos e Vencimentos

## No MVP (verificado por testes; veja MEMORY.md)
| Área | Funcionalidade |
|---|---|
| Contratos | Número por empresa, título, categoria, partes, responsável, rascunho → ativo → rescindido/encerrado, reabrir com motivo, arquivar/desarquivar, descartar rascunho, busca e filtros no servidor |
| Vigência | Determinada (início/fim) ou indeterminada; situação derivada (a iniciar, vigente, próximo do fim, fim atingido, indeterminado) |
| Aviso | Referência − dias corridos, ajuste manual com justificativa |
| Documentos | PDF, DOCX, PNG, JPEG, WebP; versões; versão atual; download por link de 60 s |
| Valores | Valor inicial, aditivos e correções, histórico cronológico, valor vigente por data |
| Renovação | Manual e auditada (nova data final ou prazo indeterminado) com justificativa |
| Reajuste | Regra por frequência, simular × aplicar, retroativo, histórico, próxima data automática |
| Obrigações | Título, responsável, data, concluir/cancelar com nota |
| Prazos | Lista e calendário mensal; faixas vencido/hoje/7/30/90 dias |
| Lembretes | Notificações internas por agendador idempotente; regras editáveis; execução manual |
| Painel | Vigentes, vencendo em 30/60/90, aviso próximo/vencido, obrigações, reajustes previstos, renovações em 12 meses, valor por periodicidade |
| Relatórios | CSV de contratos (sem CPF/CNPJ) com neutralização de fórmulas |
| Administração | Marca, fuso, prefixo, janela «próximo do fim», token do agendador, categorias |
| Segurança | Perfis, acesso por contrato, MFA para dono/admin, auditoria, CSP estrita |

## Fora do MVP (não prometer)
Assinatura eletrônica/certificada · parecer jurídico · interpretação de cláusulas · geração/edição de contratos · OCR e busca no conteúdo dos arquivos · cobrança, boleto, nota fiscal e contabilidade · renovação ou rescisão automáticas · cálculo de dias úteis/feriados · busca de índices econômicos · e-mail/WhatsApp · aplicativo nativo · IA.

## Evoluções possíveis (sob decisão do cliente)
E-mail/WhatsApp pelos lembretes (exige provedor próprio e consentimento), pré-visualização de DOCX, vínculo com o financeiro, modelos de contrato, índices econômicos importados, anexos de obrigações.
