import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = ["index.html", "styles.css", "config.js", "app.js", "README.md", ".github/workflows/deploy-pages.yml", "backend/Code.gs", "docs/CONFIGURAR_GOOGLE_APPS_SCRIPT.md"];
for (const file of required) {
  const stat = await fs.stat(path.join(root, file));
  assert.ok(stat.isFile(), `arquivo ausente: ${file}`);
}

const html = await fs.readFile(path.join(root, "index.html"), "utf8");
const js = await fs.readFile(path.join(root, "app.js"), "utf8");
const workflow = await fs.readFile(path.join(root, ".github/workflows/deploy-pages.yml"), "utf8");
const backend = await fs.readFile(path.join(root, "backend/Code.gs"), "utf8");

for (const marker of ["authScreen", "dashboard", "lancamentos", "contas", "fixos", "cdb", "analises", "configuracoes"]) assert.match(html, new RegExp(marker), `seção ausente: ${marker}`);
for (const marker of ["PBKDF2", "AES-GCM", "saveCurrentVault", "renderAnalyses", "loadGoogleAuth", "AbortController", "baseRevision"]) assert.match(js, new RegExp(marker), `regra ausente: ${marker}`);
assert.match(workflow, /actions\/deploy-pages@v4/);
for (const marker of ["verifyIdToken_", "DRIVE_FOLDER_ID", "subjectId", "VaultJournal", "LockService", "checksum_", "createFile"]) assert.match(backend, new RegExp(marker), `backend incompleto: ${marker}`);
assert.doesNotMatch(html, /Enaex|enaex/i, "a marca de referência não deve aparecer na interface");
assert.doesNotMatch(js, /password\s*[:=]\s*["'][^"']+["']/i, "não deve haver senha fixa no código");
console.log(`validate: ${required.length} arquivos e contratos principais OK`);
