# Minha contabilidade

Painel online para organizar entradas, saídas, contas bancárias, custos fixos e aplicações em CDB. A interface usa grafite, vermelho de destaque, divisores finos e cartões operacionais, sem logo de terceiros.

## Recursos

- cadastro e login online com usuário e senha;
- planilha Google como fonte oficial dos dados;
- histórico append-only e snapshots automáticos na pasta do Google Drive;
- visão geral por mês, saldo consolidado, entradas, saídas e resultado;
- lançamentos por conta e categoria;
- contas correntes e poupanças por banco;
- custos fixos ativos ou pausados;
- módulo específico para CDB, com taxa, liquidez e vencimento;
- análises mensais, categorias e taxa de sobra;
- workflow de GitHub Pages.

## Arquitetura online

O GitHub Pages hospeda apenas a interface pública. O Apps Script é o backend e executa como o proprietário da pasta do Drive. O cadastro, o verificador da senha, os lançamentos e o histórico são gravados nas abas Users, VaultCurrent e VaultJournal. Cada sincronização também cria um snapshot independente na pasta do Drive.

O navegador não usa localStorage, sessionStorage, IndexedDB, cache de cofre ou modo offline. A sessão e os dados ficam somente na memória enquanto a página está aberta; depois de sair ou recarregar, é necessário entrar novamente. Se a planilha estiver indisponível, o aplicativo falha fechado e não confirma a alteração.

## Configuração

Consulte [docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md](docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md). O ID da pasta e o ID da planilha ficam somente nas propriedades privadas do Apps Script. A URL pública do Web App é necessária no config.js para o Pages conseguir sincronizar.

## CDB

O módulo CDB trata projeções como estimativas. A projeção mensal só é calculada para uma taxa prefixada cadastrada e não substitui o extrato da instituição, impostos ou variações do CDI.

## Publicação

O workflow .github/workflows/deploy-pages.yml publica a raiz do repositório a cada push para main. O conteúdo de VISUAL/ é ignorado para não publicar os materiais usados apenas como referência.
