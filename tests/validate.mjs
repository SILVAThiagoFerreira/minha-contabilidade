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

for (const marker of ["authScreen", "dashboard", "lancamentos", "contas", "dividas", "fixos", "cdb", "investimentos", "analises", "configuracoes", "dashboardWealthMetrics", "analysisInvestments"]) assert.match(html, new RegExp(marker), `seção ausente: ${marker}`);
for (const marker of ["cdbAccount", "investmentType", "benchmarkRate", "cancel-form", "debtForm", "debtAccount", "debtMetrics", "debtTable", "savingsForm", "savingsAccount", "savingsSummary", "manualYield", "monthlyRate"]) assert.match(html, new RegExp(marker), `campo ausente: ${marker}`);
for (const marker of ["saveCurrentVault", "normalizeVault", "renderAnalyses", "renderInvestments", "renderDebts", "handleDebtSubmit", "editDebt", "totalDebt", "remoteAccountId", "AbortController", "baseRevision", "openRemoteAccount", "register", "login", "savings", "debts", "investments", "accountId", "handleSavingsSubmit", "investmentProjection", "benchmarkRate", "totalInvested", "editInvestment", "editFixed", "monthlyRate", "manualYield", "deleteAccount", "conta que ainda está vinculada"]) assert.match(js, new RegExp(marker), `regra ausente: ${marker}`);
for (const marker of ["debts", "investments"]) assert.match(backend, new RegExp(marker), `coleção ausente no backend: ${marker}`);
for (const marker of ["identity_", "USER_HEADERS", "register_", "authenticate_", "passwordVerifier_", "SPREADSHEET_ID", "accountId", "VaultJournal", "LockService", "checksum_", "savings"]) assert.match(backend, new RegExp(marker), `backend incompleto: ${marker}`);
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
console.log(`validate: ${required.length} arquivos e contratos principais OK`);
