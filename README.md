# Minha contabilidade

Painel online para organizar entradas, saídas, contas bancárias, patrimônio declarado, custos fixos, dívidas e investimentos. A interface usa grafite, vermelho de destaque, divisores finos e cartões operacionais, sem logo de terceiros.

## Recursos

- cadastro e login online com usuário e senha;
- troca de senha autenticada pelas configurações, sem salvar a senha no navegador;
- planilha Google como fonte oficial dos dados;
- histórico append-only na própria planilha, com revisões anteriores preservadas;
- visão geral por mês, saldo consolidado, entradas, saídas e resultado;
- lançamentos por conta e categoria, com opções específicas como compras online, vestuário, pets, viagens, serviços e impostos;
- transferências entre contas, com saída identificada na origem e entrada correspondente no destino;
- contas correntes e poupanças por banco;
- investimentos vinculados diretamente a uma conta já cadastrada;
- gerenciamento de poupança com estimativa mensal e correção manual pelo extrato;
- custos fixos ativos ou pausados;
- agenda mensal dos custos fixos, com referência de concluído e indicadores de total, pago e a pagar;
- dívidas com saldo atual, parcela, vencimento, conta de pagamento e edição;
- módulo de investimentos com CDB, Tesouro, fundos, ações, ETFs, LCI/LCA e outros;
- módulo de patrimônio para informar o valor atual de casa, carro, terra e outros bens, separado das contas e dos investimentos;
- projeção bruta de investimentos prefixados e de CDB DI pós-fixado com CDI-base informado;
- análises mensais, categorias, composição patrimonial e taxa de sobra;
- relatório financeiro avançado em TXT UTF-8, com dados brutos, métricas, padrões, alertas e perguntas prontas para uma IA;
- workflow de GitHub Pages.

As categorias de lançamentos não usam mais a opção genérica “Outros”. Quando um lançamento antigo ainda contém esse valor, ele é exibido e salvo como “Categoria não disponível no sistema”, para deixar claro que a descrição precisa ser conferida sem apagar o registro.

## Arquitetura online

O GitHub Pages hospeda apenas a interface pública. O Apps Script é o backend e grava tudo em uma única planilha online, nas abas Users, VaultCurrent e VaultJournal. O histórico append-only preserva as revisões anteriores sem criar arquivos auxiliares no Drive.

O navegador não usa localStorage, sessionStorage, IndexedDB, cache de cofre ou modo offline. A sessão e os dados ficam somente na memória enquanto a página está aberta; depois de sair ou recarregar, é necessário entrar novamente. Se a planilha estiver indisponível, o aplicativo falha fechado e não confirma a alteração.

## Troca de senha

Em `Configurações`, use o cartão `Trocar senha`. O Apps Script confere a senha atual, gera novo salt e verificador e atualiza somente o cadastro correspondente na aba `Users`. A senha antiga não é exibida nem armazenada em texto puro; depois da troca, a sessão em memória passa a usar a nova senha para as próximas sincronizações.

Se aparecer `O backend online ainda está desatualizado`, a interface publicada está correta, mas a implantação `/exec` do Apps Script ainda aponta para uma versão anterior. Nesse caso, copie novamente [backend/Code.gs](backend/Code.gs) para o projeto do Apps Script e crie uma nova versão da implantação do Web App; o GitHub Pages não atualiza Apps Script automaticamente.

## Relatório para IA

Na tela `Análises`, `Exportar relatório TXT` baixa um arquivo UTF-8 com contexto e cobertura, resumo executivo, evolução mensal, fluxo mensal de investimentos, diagnóstico da vida financeira, categorias, liquidez por conta, custos fixos, dívidas, investimentos, patrimônio, transferências, poupança, lançamentos detalhados, alertas derivados, perguntas de investigação e o cofre em JSON no final. O relatório não consulta cotações externas nem inventa valores: deixa explícitas as limitações e diferencia fatos registrados de interpretações sugeridas.

## Configuração

Consulte [docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md](docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md). O ID da planilha fica somente nas propriedades privadas do Apps Script. A URL pública do Web App é necessária no config.js para o Pages conseguir sincronizar.

## Investimentos

O módulo de investimentos trata projeções como estimativas brutas. Para um CDB DI pós-fixado, informe o percentual do CDI e a taxa-base do CDI que deseja usar na simulação; o sistema calcula a taxa equivalente e a estimativa mensal. Para os demais investimentos, é possível usar taxa prefixada, taxa manual ou deixar a projeção desativada. Nenhuma taxa de mercado é inventada ou atualizada automaticamente.

Ao cadastrar um investimento, a conta/banco é escolhida entre as contas existentes. Investimentos antigos no formato CDB continuam compatíveis e aparecem na nova aba “Investimentos”; a edição permite completar a conta e o CDI-base sem recriar a posição. Na carteira, use “Aporte” para aplicar mais na mesma posição, “Resgatar” para retirar parte ou todo o valor disponível e “Rendimento” para informar um rendimento conferido no extrato. Cada movimentação fica registrada dentro do investimento; aportes e resgates também criam o lançamento correspondente na conta escolhida, sem apagar o cadastro original.

Na aba `Análises`, os blocos de aporte do mês, resgate do mês e aporte x resgate usam apenas as movimentações registradas pelos botões `Aporte` e `Resgatar`. O capital inicial informado ao cadastrar uma posição representa o valor já declarado da carteira e não é tratado automaticamente como aporte mensal, evitando transformar posição antiga em fluxo novo.

## Dívidas

Dívidas ficam separadas dos custos fixos. O saldo atual entra no cálculo do patrimônio líquido, enquanto a parcela mensal aparece como compromisso. Uma dívida pode ser editada, pausada ou excluída, e a conta de pagamento é escolhida entre as contas cadastradas.

## Patrimônio declarado

O módulo “Patrimônio” guarda itens como casa, apartamento, carro, moto, terra ou outro bem em uma coleção própria do cofre online. Para cada item, informe o valor atual que deseja considerar, a data de referência e uma observação opcional. Esse cadastro não cria conta, saldo, lançamento, transferência ou investimento e não altera os dados financeiros existentes.

O valor dos bens aparece no painel, nas análises e no cálculo do patrimônio líquido: saldo das contas + valor atual dos investimentos + patrimônio declarado − dívidas. O sistema usa somente os valores informados pelo usuário; não estima, consulta ou inventa avaliações de mercado.

## Transferências entre contas

Use a transferência quando o dinheiro apenas mudar de uma conta cadastrada para outra. A operação relaciona a conta de origem à conta de destino e deixa claro no histórico que a saída e a entrada são partes do mesmo movimento interno. Por isso, ela não deve ser tratada como uma despesa, receita ou custo fixo nas análises; os saldos das duas contas continuam sendo atualizados.

## Agenda mensal de custos fixos

A agenda é uma referência para acompanhar os custos fixos de cada mês. Para cada custo fixo informado, o mês exibe o valor previsto e permite marcar o pagamento como concluído. Marcar como concluído não cria, altera nem duplica lançamento financeiro: o pagamento continua sendo lançado manualmente na tela de lançamentos.

Os indicadores da agenda mostram o custo fixo total previsto no mês, quanto já foi marcado como pago e quanto ainda está a pagar. A seleção do mês separa a situação de cada competência, para que a conclusão de um mês não altere a agenda dos demais.

## Poupança

Contas cadastradas como poupança aparecem em “Contas > Gerenciar rendimento”. O sistema calcula uma projeção com a taxa mensal informada (0,50% ao mês como referência inicial) e a data-base. O campo “Rendimento corrigido” permite substituir a estimativa pelo valor conferido no extrato, sem apagar o saldo da conta.

## Publicação

Este checkout não possui arquivos em `.github/workflows`; portanto, não há workflow automático de GitHub Pages configurado no repositório neste momento. Backend, documentação e materiais de referência não devem ser publicados como parte da interface pública. A publicação manual atualiza a branch `gh-pages` somente com `.nojekyll`, `index.html`, `styles.css`, `app.js` e `config.js`; depois, confirme o artefato servido em `https://silvathiagoferreira.github.io/minha-contabilidade/`.
