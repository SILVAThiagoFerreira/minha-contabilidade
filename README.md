# Minha contabilidade

Painel online para organizar entradas, saídas, contas bancárias, custos fixos e aplicações em CDB. A interface usa grafite, vermelho de destaque, divisores finos e cartões operacionais, sem logo de terceiros.

## Recursos

- cadastro e login online com usuário e senha;
- planilha Google como fonte oficial dos dados;
- histórico append-only na própria planilha, com revisões anteriores preservadas;
- visão geral por mês, saldo consolidado, entradas, saídas e resultado;
- lançamentos por conta e categoria;
- contas correntes e poupanças por banco;
- CDBs vinculados diretamente a uma conta já cadastrada;
- gerenciamento de poupança com estimativa mensal e correção manual pelo extrato;
- custos fixos ativos ou pausados;
- módulo específico para CDB, com taxa, liquidez e vencimento;
- análises mensais, categorias e taxa de sobra;
- workflow de GitHub Pages.

## Arquitetura online

O GitHub Pages hospeda apenas a interface pública. O Apps Script é o backend e grava tudo em uma única planilha online, nas abas Users, VaultCurrent e VaultJournal. O histórico append-only preserva as revisões anteriores sem criar arquivos auxiliares no Drive.

O navegador não usa localStorage, sessionStorage, IndexedDB, cache de cofre ou modo offline. A sessão e os dados ficam somente na memória enquanto a página está aberta; depois de sair ou recarregar, é necessário entrar novamente. Se a planilha estiver indisponível, o aplicativo falha fechado e não confirma a alteração.

## Configuração

Consulte [docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md](docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md). O ID da planilha fica somente nas propriedades privadas do Apps Script. A URL pública do Web App é necessária no config.js para o Pages conseguir sincronizar.

## CDB

O módulo CDB trata projeções como estimativas. A projeção mensal só é calculada para uma taxa prefixada cadastrada e não substitui o extrato da instituição, impostos ou variações do CDI.

Ao cadastrar um CDB, a instituição é escolhida entre as contas existentes. CDBs antigos que ainda tenham apenas o texto do banco continuam sendo exibidos normalmente.

## Poupança

Contas cadastradas como poupança aparecem em “Contas > Gerenciar rendimento”. O sistema calcula uma projeção com a taxa mensal informada (0,50% ao mês como referência inicial) e a data-base. O campo “Rendimento corrigido” permite substituir a estimativa pelo valor conferido no extrato, sem apagar o saldo da conta.

## Publicação

O branch `gh-pages` publica somente os quatro arquivos estáticos da interface. Backend, documentação e materiais de referência não fazem parte do artefato servido; a publicação é feita com `npx gh-pages` a partir do diretório de artefatos estáticos.
