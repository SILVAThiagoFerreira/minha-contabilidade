# Minha contabilidade

Painel pessoal para organizar entradas, saídas, contas bancárias, custos fixos e aplicações em CDB. A interface foi inspirada na referência visual fornecida: grafite, vermelho de destaque, divisores finos e cartões operacionais, sem logo de terceiros.

## O que já está disponível

- login e criação de conta local com senha;
- dados separados por usuário no navegador;
- cofre local criptografado com PBKDF2 + AES-GCM;
- visão geral por mês, saldo consolidado, entradas, saídas e resultado;
- lançamentos por conta e categoria;
- contas correntes e poupanças por banco;
- custos fixos ativos ou pausados;
- módulo específico para CDB, com taxa, liquidez e vencimento;
- análises mensais, categorias e taxa de sobra;
- exportação e importação manual de backup JSON;
- modo online com login Google, Google Apps Script e Google Sheets/Drive;
- armazenamento resiliente com estado atual, journal append-only, checksum e snapshots;
- workflow de GitHub Pages.

## Segurança e limite do GitHub Pages

GitHub Pages não é um servidor de aplicação nem um banco de dados. Por isso, o site publicado não carrega dados financeiros reais e não contém segredos. O login Google e a sincronização online usam o backend documentado em [`docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md`](docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md). A pasta do Drive precisa estar com acesso restrito; se outras pessoas puderem abrir a planilha diretamente, elas poderão ver os dados independentemente do filtro por usuário.

O backend armazena uma revisão corrente por conta Google, mantém um journal sem sobrescrita e cria snapshots JSON novos na pasta privada configurada. Isso reduz o risco de perda e permite recuperar a última revisão válida, mas uma segunda cópia independente continua recomendada para uma contabilidade importante.

O módulo CDB trata projeções como estimativas. A projeção mensal só é calculada para uma taxa prefixada cadastrada e não substitui o extrato da instituição, impostos ou variações do CDI.

## Rodar localmente

Como o projeto é estático, qualquer servidor HTTP serve a pasta:

```powershell
python -m http.server 4173
```

Abra `http://localhost:4173/`. Abrir o arquivo diretamente com `file://` pode impedir a Web Crypto API em alguns navegadores.

## Publicação

O workflow `.github/workflows/deploy-pages.yml` publica a raiz do repositório em cada push para `main`. O conteúdo de `VISUAL/` é ignorado para não publicar os PDFs e logos usados apenas como referência.
