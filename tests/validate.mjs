import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = ["index.html", "styles.css", "config.js", "app.js", "README.md", "backend/Code.gs", "docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md"];
for (const file of required) {
  const stat = await fs.stat(path.join(root, file));
  assert.ok(stat.isFile(), `arquivo ausente: ${file}`);
}

const html = await fs.readFile(path.join(root, "index.html"), "utf8");
const js = await fs.readFile(path.join(root, "app.js"), "utf8");
const backend = await fs.readFile(path.join(root, "backend/Code.gs"), "utf8");
const config = await fs.readFile(path.join(root, "config.js"), "utf8");
const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
const featureFailures = [];

function assertAny(source, patterns, message) {
  if (!patterns.some((pattern) => pattern.test(source))) featureFailures.push(message);
}

for (const marker of ["authScreen", "dashboard", "lancamentos", "contas", "dividas", "fixos", "cdb", "investimentos", "patrimonio", "analises", "configuracoes", "dashboardWealthMetrics", "analysisInvestments", "analysisPatrimony", "patrimonyForm", "passwordForm", "export-ai-report"]) assert.match(html, new RegExp(marker), `seção ausente: ${marker}`);
for (const marker of ["cdbAccount", "investmentType", "benchmarkRate", "cancel-form", "debtForm", "debtAccount", "debtMetrics", "debtTable", "savingsForm", "savingsAccount", "savingsSummary", "manualYield", "monthlyRate", "investmentOperationDialog", "investmentOperationForm", "investmentOperationAccount"]) assert.match(html, new RegExp(marker), `campo ausente: ${marker}`);
for (const marker of ["saveCurrentVault", "normalizeVault", "renderAnalyses", "renderInvestments", "renderPatrimony", "renderDebts", "handleDebtSubmit", "handlePatrimonySubmit", "editDebt", "editPatrimony", "totalDebt", "totalPatrimony", "remoteAccountId", "AbortController", "baseRevision", "openRemoteAccount", "changeRemotePassword", "handlePasswordSubmit", "buildAiReport", "exportAiReport", "reportMonthKeys", "operationalTransactions", "investmentTransactions", "investmentOperationType", "register", "login", "savings", "debts", "investments", "patrimony", "accountId", "handleSavingsSubmit", "investmentProjection", "benchmarkRate", "totalInvested", "totalInvestmentValue", "investmentYield", "investmentCurrentValue", "investmentHasHistory", "handleInvestmentOperationSubmit", "open-investment-operation", "operations", "investmentOperationId", "investmentOperationAccount", "balanceAfter", "editInvestment", "editFixed", "monthlyRate", "manualYield", "deleteAccount", "deleteInvestment", "conta que ainda está vinculada"]) assert.match(js, new RegExp(marker), `regra ausente: ${marker}`);
assert.match(js, /minimumFractionDigits:\s*2/, "a moeda precisa sempre exibir duas casas decimais");
assert.match(js, /function formatMoneyInput/, "a máscara de moeda precisa existir");
assert.match(js, /function setupMoneyInputs/, "os campos monetários precisam ser configurados");
assert.match(js, /#transactionForm \[name='amount'\]/, "o valor do lançamento precisa usar a máscara");
assert.match(js, /#investmentOperationAmount/, "a operação de investimento precisa usar a máscara");
assert.doesNotMatch(js, /R\$ .*mil|R\$ .* mi/, "a exibição não deve abreviar valores em mil ou milhões");
assert.match(html, /R\$ 4\.820,00/, "os valores demonstrativos também precisam ter duas casas");
for (const marker of ["debts", "investments", "patrimony", "validatePatrimony_", "validateInvestmentOperations_", "investmentByOperation", "transactionCount", "operations"]) assert.match(backend, new RegExp(marker), `coleção ausente no backend: ${marker}`);
for (const marker of ["identity_", "USER_HEADERS", "register_", "authenticate_", "changePassword_", "change-password", "passwordVerifier_", "SPREADSHEET_ID", "accountId", "VaultJournal", "LockService", "checksum_", "savings"]) assert.match(backend, new RegExp(marker), `backend incompleto: ${marker}`);

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
for (const category of ["Compras online", "Vestuário", "Cuidados pessoais", "Pets", "Viagens", "Impostos e taxas", "Serviços", "Doações", "Categoria não disponível no sistema"]) {
  assert.match(js, new RegExp(category), `categoria ausente: ${category}`);
}
assert.match(js, /normalizeLaunchCategory/, "categorias antigas precisam ser normalizadas");
assert.match(js, /toLowerCase\(\)\s*===\s*["']outros["']/, "o valor legado Outros precisa ser migrado");
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
assert.match(config, /apiUrl:\s*[""][^""]+[""]/i, "o endpoint online precisa estar configurado");
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
assert.match(js, /text\/plain;charset=utf-8/, "o relatório precisa ser exportado como TXT UTF-8");
for (const marker of ["RESUMO EXECUTIVO", "PADRÕES E INSIGHTS DERIVADOS", "EVOLUÇÃO MENSAL", "LANÇAMENTOS DETALHADOS", "DADOS BRUTOS EM JSON", "PERGUNTAS PARA A IA INVESTIGAR"]) assert.match(js, new RegExp(marker), `seção ausente no relatório IA: ${marker}`);
assert.match(readme, /Troca de senha/i, "o README precisa documentar a troca de senha");
assert.match(readme, /relatório financeiro avançado em TXT/i, "o README precisa documentar o relatório para IA");
console.log(`validate: ${required.length} arquivos e contratos principais OK`);
