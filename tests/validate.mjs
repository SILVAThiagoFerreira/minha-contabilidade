import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = ["index.html", "styles.css", "config.js", "app.js", "release.json", "README.md", "CONTRIBUTING.md", "SECURITY.md", "backend/Code.gs", "docs/ARCHITECTURE.md", "docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md", "docs/OPERATIONS_PRIVATE.md.example", "docs/RECUPERACAO_DE_ACESSO.md", "docs/ADMINISTRACAO.md"];
for (const file of required) {
  const stat = await fs.stat(path.join(root, file));
  assert.ok(stat.isFile(), `arquivo ausente: ${file}`);
}

const html = await fs.readFile(path.join(root, "index.html"), "utf8");
const js = await fs.readFile(path.join(root, "app.js"), "utf8");
const css = await fs.readFile(path.join(root, "styles.css"), "utf8");
const backend = await fs.readFile(path.join(root, "backend/Code.gs"), "utf8");
const config = await fs.readFile(path.join(root, "config.js"), "utf8");
const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
const release = JSON.parse(await fs.readFile(path.join(root, "release.json"), "utf8"));
const publicDocs = await Promise.all(["README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/ARCHITECTURE.md", "docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md", "docs/OPERATIONS_PRIVATE.md.example", "docs/RECUPERACAO_DE_ACESSO.md"].map((file) => fs.readFile(path.join(root, file), "utf8")));
const featureFailures = [];

function assertAny(source, patterns, message) {
  if (!patterns.some((pattern) => pattern.test(source))) featureFailures.push(message);
}

for (const marker of ["authScreen", "dashboard", "lancamentos", "contas", "dividas", "fixos", "cdb", "investimentos", "patrimonio", "analises", "configuracoes", "administracao", "adminNavItem", "adminMetrics", "adminUsersTable", "adminSystemTable", "dashboardWealthMetrics", "analysisInvestments", "analysisPatrimony", "analysisInvestmentFlow", "analysisEssentialCosts", "patrimonyForm", "passwordForm", "profileMonthlySalary", "profileAverageMonthlySalaryWithOvertime", "export-ai-report"]) assert.match(html, new RegExp(marker), `seção ausente: ${marker}`);
for (const marker of ["cdbAccount", "investmentType", "benchmarkRate", "cancel-form", "debtForm", "debtAccount", "debtMetrics", "debtTable", "savingsForm", "savingsAccount", "savingsSummary", "manualYield", "monthlyRate", "investmentOperationDialog", "investmentOperationForm", "investmentOperationAccount"]) assert.match(html, new RegExp(marker), `campo ausente: ${marker}`);
for (const marker of ["saveCurrentVault", "normalizeVault", "renderAnalyses", "renderInvestments", "renderPatrimony", "renderDebts", "handleDebtSubmit", "handlePatrimonySubmit", "editDebt", "editPatrimony", "totalDebt", "totalPatrimony", "remoteAccountId", "AbortController", "baseRevision", "openRemoteAccount", "changeRemotePassword", "handlePasswordSubmit", "backend online ainda está desatualizado", "buildAiReport", "exportAiReport", "reportMonthKeys", "operationalTransactions", "investmentTransactions", "investmentOperationType", "investmentFlowForPeriod", "investmentTransactionsForPeriod", "netInvestment", "investmentRate", "register", "login", "savings", "debts", "investments", "patrimony", "accountId", "handleSavingsSubmit", "investmentProjection", "benchmarkRate", "totalInvested", "totalInvestmentValue", "investmentYield", "investmentCurrentValue", "investmentHasHistory", "handleInvestmentOperationSubmit", "open-investment-operation", "operations", "investmentOperationId", "investmentOperationAccount", "balanceAfter", "editInvestment", "editFixed", "monthlyRate", "manualYield", "monthlySalary", "averageMonthlySalaryWithOvertime", "deleteAccount", "deleteInvestment", "accountReportLabel", "conta que ainda está vinculada"]) assert.match(js, new RegExp(marker), `regra ausente: ${marker}`);
assert.match(js, /minimumFractionDigits:\s*2/, "a moeda precisa sempre exibir duas casas decimais");
assert.match(js, /function formatMoneyInput/, "a máscara de moeda precisa existir");
assert.match(js, /function setupMoneyInputs/, "os campos monetários precisam ser configurados");
assert.match(js, /#transactionForm \[name='amount'\]/, "o valor do lançamento precisa usar a máscara");
assert.match(js, /#profileForm \[name='monthlySalary'\]/, "o salário mensal cadastral precisa usar a máscara de moeda");
assert.match(js, /#profileForm \[name='averageMonthlySalaryWithOvertime'\]/, "o salário médio com horas extras precisa usar a máscara de moeda");
assert.match(js, /#investmentOperationAmount/, "a operação de investimento precisa usar a máscara");
assert.doesNotMatch(js, /R\$ .*mil|R\$ .* mi/, "a exibição não deve abreviar valores em mil ou milhões");
assert.match(html, /R\$ 4\.820,00/, "os valores demonstrativos também precisam ter duas casas");
for (const marker of ["debts", "investments", "patrimony", "validateDebts_", "validatePatrimony_", "validateInvestmentOperations_", "investmentByOperation", "transactionCount", "operations"]) assert.match(backend, new RegExp(marker), `coleção ausente no backend: ${marker}`);
for (const marker of ["identity_", "USER_HEADERS", "register_", "authenticate_", "changePassword_", "change-password", "passwordVerifier_", "SPREADSHEET_ID", "accountId", "VaultJournal", "LockService", "checksum_", "savings", "admin-dashboard", "adminDashboard_", "requireAdmin_", "provisionAdminFromScriptProperties", "promoteExistingAdminFromScriptProperties", "ADMIN_PASSWORD", "AccessLog", "recordAccess_", "accessRows_", "request-password-reset", "confirm-password-reset", "PasswordResets", "MailApp", "PASSWORD_RESET_TTL_MS"]) assert.match(backend, new RegExp(marker), `backend incompleto: ${marker}`);

// Transferências são uma operação pareada: a conta de origem recebe a saída,
// a conta de destino recebe a entrada e o restante do sistema pode identificá-las.
assertAny(html, [/transfer/i, /transferência/i], "a interface precisa expor o recurso de transferência");
assertAny(html, [/fromAccount|sourceAccount|origem/i], "a transferência precisa identificar a conta de origem");
assertAny(html, [/toAccount|targetAccount|destino/i], "a transferência precisa identificar a conta de destino");
assertAny(js, [/handleTransfer|submitTransfer|transfer/i], "o frontend precisa tratar o envio de transferências");
assertAny(js, [/fromAccount|sourceAccount|contaOrigem|origem/i], "o frontend precisa preservar a conta de origem da transferência");
assertAny(js, [/toAccount|targetAccount|contaDestino|destino/i], "o frontend precisa preservar a conta de destino da transferência");
assertAny(backend, [/transfer/i], "o backend precisa reconhecer transferências");
assertAny(backend, [/fromAccount|sourceAccount|contaOrigem|origem/i], "o backend precisa reconhecer a origem da transferência");
assertAny(backend, [/toAccount|targetAccount|contaDestino|destino/i], "o backend precisa reconhecer o destino da transferência");
assertAny(backend, [/transaction|lancamento|entrada|saida/i], "a transferência precisa ser registrada no histórico financeiro");

// As categorias de lançamentos devem ser específicas e não podem esconder
// registros antigos atrás do rótulo genérico "Outros".
for (const category of ["Compras online", "Vestuário", "Cuidados pessoais", "Pets", "Viagens", "Impostos e taxas", "Serviços", "Doações", "Salário", "Salário Parte 1", "Salário Parte 2", "Transporte - Manutenção", "Transporte - Combustivel", "Salário mensal \\(Carteira de trabalho\\)", "Categoria não disponível no sistema"]) {
  assert.match(js, new RegExp(category), `categoria ausente: ${category}`);
}
assert.match(js, /normalizeLaunchCategory/, "categorias antigas precisam ser normalizadas");
assert.match(js, /function normalizeCustomCategories/, "as categorias personalizadas precisam ser normalizadas por perfil");
assert.match(js, /function launchCategories/, "as categorias personalizadas precisam entrar na lista de lançamentos");
assert.match(js, /customCategories/, "o perfil precisa preservar as categorias personalizadas");
assert.match(js, /handleCustomCategorySubmit/, "o frontend precisa permitir criar categorias personalizadas");
assert.match(js, /editCustomCategory/, "o frontend precisa permitir editar categorias personalizadas");
assert.match(js, /deleteCustomCategory/, "o frontend precisa permitir remover uma categoria apenas das novas seleções");
assert.match(html, /customCategoriesForm/, "as configurações precisam expor o formulário de categoria personalizada");
assert.match(html, /customCategoriesList/, "as configurações precisam listar categorias personalizadas");
assert.match(backend, /function validateCustomCategories_/, "o backend precisa validar categorias personalizadas");
assert.match(backend, /MAX_CUSTOM_CATEGORIES/, "o backend precisa limitar categorias personalizadas");
assert.match(js, /toLowerCase\(\)\s*===\s*["']outros["']/, "o valor legado Outros precisa ser migrado");
assert.match(js, /value\s*===\s*["']Salário mensal["'].*Salário mensal \(Carteira de trabalho\)/, "a categoria legada Salário mensal precisa migrar para Carteira de trabalho");
assert.match(js, /FIXED_COST_CATEGORIES\s*=\s*CATEGORIES\.filter/, "custos fixos precisam ter uma lista filtrada de categorias");
assert.match(js, /SALARY_CATEGORIES\s*=\s*\[/, "as categorias salariais precisam compartilhar um agrupamento central");
assert.match(js, /TRANSPORT_CATEGORIES\s*=\s*\[/, "as categorias de transporte precisam compartilhar um agrupamento central");
assert.match(js, /function categoryGroupTotalForPeriod/, "a análise mensal precisa calcular grupos de categorias");
assert.match(js, /function essentialMonthlyCosts/, "a análise mensal precisa consolidar transporte, alimentação e salários");
assert.match(js, /ALL_PERIODS\s*=\s*["']todos["']/, "o filtro de período precisa oferecer Todos");
assert.match(js, /<option value="\$\{ALL_PERIODS\}">Todos<\/option>/, "Todos precisa estar disponível no seletor de período");
assert.match(js, /function trendPeriods/, "as análises precisam montar a série histórica para Todos");
assert.match(js, /aporteCount/, "as análises precisam contar aportes");
assert.match(js, /resgateCount/, "as análises precisam contar retiradas");
assert.match(html, /analysisInvestmentCountChart/, "as análises precisam exibir gráfico de quantidade de movimentações de investimento");
assert.match(js, /interactiveChartBar/, "as barras dos gráficos precisam oferecer interação acessível");
assert.match(js, /tabindex="0"/, "as barras dos gráficos precisam poder receber foco pelo teclado");
assert.match(css, /chart-tooltip/, "os gráficos precisam exibir tooltip ao interagir com uma barra");
assert.match(js, /function tableSortHeader/, "a tabela de lançamentos precisa permitir ordenar por coluna");
assert.match(js, /function enhanceSortableTables/, "as demais tabelas precisam ter ordenação por cabeçalho");
assert.match(js, /sort-dom-table/, "a ordenação das tabelas precisa responder ao clique no cabeçalho");
assert.match(css, /data-table--transactions/, "a tabela de lançamentos precisa ter uma apresentação responsiva própria");
assert.match(html, /<title>MINHA CONTABILIDADE<\/title>/, "o título da aba precisa usar MINHA CONTABILIDADE");
assert.match(html, /favicon\.svg/, "a aba precisa usar o ícone do aplicativo");
assert.match(html, /class="auth-mark"[^>]*>MC<\/div>/, "a marca de acesso precisa usar o monograma MC");
assert.match(html, /class="brand-symbol"[^>]*>MC<\/div>/, "a marca lateral precisa usar o monograma MC");
assert.match(css, /#f3b21a/, "a identidade premium precisa usar o dourado da nova paleta");
assert.match(html, /deixar o investimento trabalhando com você/, "a apresentação precisa falar de investimento de forma ampla");
assert.doesNotMatch(html, /Seu cadastro e seus dados ficam armazenados online na planilha\./, "a nota de armazenamento não deve aparecer no login");
assert.doesNotMatch(html, /<h3>Armazenamento online<\/h3>/, "o cartão de armazenamento online não deve aparecer em configurações");
assert.match(html, /dados são transmitidos por conexão segura e armazenados separadamente do código publicado/, "a mensagem de privacidade precisa refletir a proteção realmente implementada");
assert.doesNotMatch(html, /criptografia de ponta a ponta/i, "a interface não deve alegar criptografia de ponta a ponta sem implementá-la");
assert.match(js, /function tableSortHeader/, "as tabelas precisam expor cabeçalhos ordenáveis");
assert.match(js, /function enhanceSortableTables/, "as tabelas de dados precisam receber ordenação clicável");
assert.match(js, /data-table--transactions/, "a tabela Seus movimentos precisa ter tratamento responsivo próprio");
assert.match(js, /!item\.transferId && !item\.investmentOperationId/, "a análise por grupos deve excluir transferências e investimentos");
assert.match(js, /categoryGroupTotalForPeriod\(period, SALARY_CATEGORIES, "entrada"\)/, "salários recebidos devem considerar apenas entradas");
assert.ok(js.includes('const FIXED_COST_CATEGORIES = CATEGORIES.filter((category) => !SALARY_CATEGORIES.includes(category));'), "categorias de salário devem ficar fora dos custos fixos");
assert.match(readme, /Transporte, alimentação e salários por mês/i, "o README precisa documentar a análise mensal essencial");
assert.match(readme, /Transferências internas e operações de investimento não entram nesses totais/i, "o README precisa documentar as exclusões da análise essencial");
assert.match(html, /fixedCostCategory/, "o formulário de custos fixos precisa usar a lista centralizada de categorias");
assert.doesNotMatch(html, /<option>Outros<\/option>/i, "o select de custos fixos não deve expor Outros");

// A agenda controla referência mensal e indicadores, sem duplicar o lançamento manual.
assertAny(html, [/agenda|schedule/i], "a interface precisa expor a agenda de custos fixos");
assertAny(html, [/fixo|fixed/i], "a agenda precisa estar vinculada aos custos fixos");
assertAny(html, [/conclu|pago|pendente|a pagar/i], "a agenda precisa permitir identificar pagamentos concluídos e pendentes");
assertAny(js, [/agenda|schedule/i], "o frontend precisa tratar a agenda mensal");
assertAny(js, [/conclu|completed|paid|pendente|pending/i], "o frontend precisa persistir o estado de conclusão da agenda");
assertAny(js, [/total.*(m[eê]s|month)|paid|pago|pending|pendente/i], "o frontend precisa calcular os indicadores da agenda");
assert.match(js, /item\??\.period\s*\|\|\s*item\??\.month/i, "o frontend precisa manter compatibilidade com o período legado da agenda");
assert.match(js, /item\.completed\s*!==\s*false/i, "a agenda não pode considerar uma marcação explicitamente desfeita como paga");
assert.match(js, /previousPayments|previousTransfers/i, "ações sincronizadas precisam restaurar o estado local quando a gravação falhar");
assertAny(backend, [/fixed|fixo/i], "o backend precisa reconhecer custos fixos");
assertAny(backend, [/conclu|completed|paid|pendente|pending|schedule|agenda/i], "o backend precisa reconhecer o estado mensal da agenda");
assert.match(backend, /validateFixedCostPayments_\(payload\.fixedCostPayments \|\| \[\], payload\.fixedCosts \|\| \[\]\)/i, "o backend precisa validar a referência do custo fixo da agenda");

assert.match(readme, /## Transferências entre contas/i, "o README precisa documentar transferências entre contas");
assert.match(readme, /saída.*entrada.*mesmo movimento interno/i, "o README precisa explicar a relação entre saída e entrada da transferência");
assert.match(readme, /não deve ser tratada como uma despesa, receita ou custo fixo/i, "o README precisa separar transferências das análises de receitas e despesas");
assert.match(readme, /## Agenda mensal de custos fixos/i, "o README precisa documentar a agenda mensal");
assert.match(readme, /não cria, altera nem duplica lançamento financeiro/i, "o README precisa documentar que concluir não lança valor");
assert.match(readme, /total.*previsto.*mês.*pago.*a pagar/i, "o README precisa documentar os indicadores da agenda");

const workflowEntries = await fs.readdir(path.join(root, ".github", "workflows")).catch(() => []);
const workflowFiles = workflowEntries.filter((entry) => /\.(yaml|yml)$/i.test(entry));
if (workflowFiles.length === 0) {
  assert.match(readme, /não possui arquivos em `\.github\/workflows`/i, "o README precisa refletir que não há workflow de Pages neste checkout");
}

assert.deepEqual(featureFailures, [], `contratos de transferências/agenda ausentes:\n- ${featureFailures.join("\n- ")}`);
assert.match(config, /apiUrl:\s*["'][^"']+["']/i, "o endpoint online precisa estar configurado");
assert.match(String(release.version || ""), /^\d{8}\.\d+$/, "o manifesto de publicação precisa ter uma versão previsível");
assert.match(html, /release\.json\?ts=/, "o HTML precisa consultar o manifesto de publicação sem cache");
assert.match(js, /monitorPublishedRelease/, "o frontend precisa detectar uma nova publicação");
assert.match(js, /admin-dashboard/, "o painel administrativo precisa consultar indicadores pelo backend");
assert.match(js, /session\?\.role !== "admin"/, "o painel administrativo precisa ser protegido por papel de sessão");
assert.match(js, /function refreshAdminDashboard/, "o painel administrativo precisa atualizar os indicadores");
assert.match(html, /Nenhum lançamento, saldo ou dado financeiro individual/, "o painel administrativo não deve exibir dados financeiros individuais");
assert.match(html, /profilePhotoInput/, "as configurações precisam permitir selecionar uma foto de perfil");
assert.match(html, /authPasswordToggle/, "a tela de acesso precisa permitir mostrar ou ocultar a senha digitada");
assert.match(html, /forgotPasswordButton/, "a tela de acesso precisa oferecer recuperação de senha");
assert.match(html, /passwordRecoveryRequestForm/, "a recuperação precisa solicitar o usuário");
assert.match(js, /handlePasswordRecoveryRequest/, "o frontend precisa solicitar recuperação de senha");
assert.match(js, /handlePasswordRecoveryConfirm/, "o frontend precisa confirmar a nova senha pelo token");
assert.match(js, /email_missing/, "usuários sem e-mail precisam receber o aviso de recuperação indisponível");
assert.match(js, /openProfilePhotoEditor/, "a foto precisa oferecer ajuste de enquadramento antes de salvar");
assert.match(html, /profileEmail/, "as configurações precisam solicitar um e-mail de recuperação");
assert.match(html, /profileEmailNotice/, "usuários sem e-mail precisam receber uma orientação visível");
assert.match(js, /resizeProfilePhoto/, "a foto precisa ser reduzida antes da sincronização");
assert.match(js, /pointerdown/, "o enquadramento da foto precisa permitir ajuste direto na grade");
assert.match(js, /removeProfilePhoto/, "a foto do perfil precisa poder ser removida");
assert.match(js, /normalizeProfileEmail/, "o e-mail do perfil precisa ser validado no frontend");
assert.match(backend, /validateProfile_/, "o perfil precisa ser validado no backend");
assert.match(backend, /MAX_PROFILE_PHOTO_CHARS/, "o backend precisa limitar o tamanho da foto de perfil");
assert.match(css, /auth-mark, \.brand-symbol/, "a marca MC precisa compartilhar o estilo do quadrado");
for (const document of publicDocs) {
  assert.doesNotMatch(document, /docs\.google\.com\/spreadsheets\/d\/|drive\.google\.com\//i, "documentação pública não pode expor links privados do Drive");
  assert.doesNotMatch(document, /SPREADSHEET_ID\s*\|\s*`[A-Za-z0-9_-]{20,}`/i, "documentação pública não pode expor o ID da planilha");
}
assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|caches\.|CacheStorage|serviceWorker/i, "o frontend não deve persistir dados no navegador");
assert.doesNotMatch(js, /fallbackVault|mode:\s*["']local["']|cacheLocalVault|createLocalAccount|loginLocal/i, "o frontend não deve oferecer fallback local");
assert.doesNotMatch(html, /googleAuth|googleButton|Entrar com Google/i, "o login Google não deve aparecer na interface");
assert.doesNotMatch(js, /googleClientId|loadGoogleAuth|handleGoogleCredential|gsi\/client|idToken/i, "o frontend não deve depender do login Google");
assert.doesNotMatch(backend, /verifyIdToken_|oauth2\.googleapis|GOOGLE_CLIENT_ID|ALLOWED_EMAILS|idToken/i, "o backend não deve validar login Google");
assert.doesNotMatch(backend, /DriveApp|writeDriveSnapshot_|backupWarning|folder_|DRIVE_FOLDER_ID|MimeType\.PLAIN_TEXT/i, "o backend não deve criar arquivos ou depender de pasta do Drive");
assert.doesNotMatch(js, /backupWarning|snapshots? automáticos?|snapshot[^\n]*(?:Drive|pasta)/i, "o frontend não deve prometer snapshots no Drive");
assert.doesNotMatch(js, /prefixPositions|PARTICIPAÇÃO EM CDB/i, "as análises não devem ficar limitadas ao CDB prefixado");
assert.doesNotMatch(html, /Enaex|enaex/i, "a marca de referência não deve aparecer na interface");
assert.doesNotMatch(js, /password\s*[:=]\s*["'][^"']+["']/i, "não deve haver senha fixa no código");
assert.doesNotMatch(backend, /ADMIN_PASSWORD\s*[:=]\s*["'][^"']+["']/i, "a senha administrativa não pode ser fixa no backend");
assert.match(js, /text\/plain;charset=utf-8/, "o relatório precisa ser exportado como TXT UTF-8");
for (const marker of ["RESUMO EXECUTIVO", "PADRÕES E INSIGHTS DERIVADOS", "EVOLUÇÃO MENSAL", "FLUXO MENSAL DE INVESTIMENTOS", "DIAGNÓSTICO DA VIDA FINANCEIRA", "relação_aportes_vs_resgates", "resgates_sobre_aportes", "aporte_liquido", "LANÇAMENTOS DETALHADOS", "DADOS BRUTOS EM JSON", "PERGUNTAS PARA A IA INVESTIGAR", "INFORMAÇÕES PARA IMPOSTO DE RENDA - DADOS DECLARADOS"]) assert.match(js, new RegExp(marker), `seção ausente no relatório IA: ${marker}`);
for (const marker of ["identificação curta", "dívida | credor | saldo atual declarado | parcela mensal declarada", "conta/banco vinculado", "saldo_atual_declarado", "parcela_mensal_declarada", "conta_banco_vinculado", "Movimentações de investimentos", "saldo_após", "soma das parcelas; não é saldo", "PARCELA MENSAL"]) assert.match(js, new RegExp(marker), `campo fiscal/clareza ausente: ${marker}`);
assert.match(backend, /validateDebts_\(payload\.debts \|\| \[\], payload\.accounts \|\| \[\]\)/i, "o backend precisa validar dívidas com referência de conta");
assert.match(backend, /saldo atual da dívida precisa ser maior ou igual a zero/i, "o backend precisa bloquear saldo de dívida inválido");
assert.match(backend, /parcela mensal da dívida precisa ser maior ou igual a zero/i, "o backend precisa bloquear parcela de dívida inválida");
assert.match(js, /Salário mensal \(Carteira de trabalho\) informado para referência/, "o relatório precisa incluir o salário de carteira somente como referência cadastral");
assert.match(js, /Salário Mensal Médio \+ Horas Extras informado para análise/, "o relatório precisa incluir o salário médio com horas extras somente como referência de análise");
assert.doesNotMatch(js, /Salário mensal \(Carteira de trabalho\) cadastral|Salário Mensal Médio \+ Horas Extras cadastral/, "salários declarados não devem aparecer no resumo como cálculo de receita");
assert.match(js, /maturityAt\s*\|\|\s*item\.dueDate/, "o relatório precisa usar maturityAt como vencimento do investimento");
assert.match(readme, /Troca de senha/i, "o README precisa documentar a troca de senha");
assert.match(readme, /relatório financeiro avançado em TXT/i, "o README precisa documentar o relatório para IA");
console.log(`validate: ${required.length} arquivos e contratos principais OK`);
