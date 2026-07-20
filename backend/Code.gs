/**
 * Backend do modo online de Minha contabilidade.
 *
 * O Web App executa como o proprietário e nunca entrega a planilha ao
 * navegador. A identidade vem da conta local criada no aplicativo; somente
 * um identificador derivado do usuário é usado para particionar as linhas.
 *
 * Armazenamento resiliente por gravação:
 *   1. VaultCurrent: estado atual por usuário local;
 *   2. VaultJournal: histórico append-only, escrito antes do estado atual;
 *   3. snapshot JSON imutável na pasta privada do Drive.
 *
 * O ID da pasta informado pelo usuário é apenas um destino. A pasta deve
 * permanecer com acesso "Restrito" e sem membros que não possam ver os
 * dados financeiros.
 */
const DEFAULT_CONFIG = {
  // Defina DRIVE_FOLDER_ID nas propriedades privadas do Apps Script.
  driveFolderId: "",
  spreadsheetId: "",
  spreadsheetName: "Minha Contabilidade - Banco"
};

const CURRENT_HEADERS = ["accountId", "username", "revision", "updatedAt", "checksum", "payload"];
const JOURNAL_HEADERS = ["journalId", "accountId", "username", "revision", "updatedAt", "checksum", "payload", "source"];
const MAX_PAYLOAD_BYTES = 450000;
const MAX_ITEMS_PER_COLLECTION = 10000;

function doGet() {
  return json_({ ok: true, service: "minha-contabilidade", storage: "VaultCurrent + VaultJournal + Drive snapshots" });
}

function doPost(event) {
  try {
    const body = JSON.parse(event?.postData?.contents || "{}");
    const identity = identity_(body);
    if (body.action === "get") return json_(getVault_(identity));
    if (body.action === "sync") return json_(saveVault_(identity, body.payload, body.baseRevision));
    return json_({ ok: false, error: "Ação não reconhecida." }, 400);
  } catch (error) {
    return json_({ ok: false, error: error.message || "Falha no backend." }, 400);
  }
}

function json_(payload, statusCode) {
  // Apps Script não expõe um setter confiável de status HTTP no ContentService.
  // O contrato inclui statusCode e ok para o frontend tratar a resposta.
  return ContentService.createTextOutput(JSON.stringify({ ...payload, statusCode: statusCode || 200 }))
    .setMimeType(ContentService.MimeType.JSON);
}

function config_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    driveFolderId: properties.getProperty("DRIVE_FOLDER_ID") || DEFAULT_CONFIG.driveFolderId,
    spreadsheetId: properties.getProperty("SPREADSHEET_ID") || DEFAULT_CONFIG.spreadsheetId,
    spreadsheetName: properties.getProperty("SPREADSHEET_NAME") || DEFAULT_CONFIG.spreadsheetName,
  };
}

function identity_(body) {
  const accountId = String(body.accountId || "").trim().toLowerCase();
  const username = String(body.username || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(accountId)) throw new Error("Identificador local inválido.");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("Usuário local inválido.");
  return { accountId, username };
}

function folder_() {
  const id = config_().driveFolderId;
  if (!id) throw new Error("DRIVE_FOLDER_ID não configurado.");
  return DriveApp.getFolderById(id);
}

function spreadsheet_() {
  const config = config_();
  if (config.spreadsheetId) return SpreadsheetApp.openById(config.spreadsheetId);

  const folder = folder_();
  const files = folder.getFilesByName(config.spreadsheetName);
  if (files.hasNext()) return SpreadsheetApp.openById(files.next().getId());

  const spreadsheet = SpreadsheetApp.create(config.spreadsheetName);
  const file = DriveApp.getFileById(spreadsheet.getId());
  try {
    file.moveTo(folder);
  } catch (error) {
    // Compatibilidade com contas onde File.moveTo não está disponível.
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  }
  return spreadsheet;
}

function sheetWithHeaders_(name, headers) {
  const spreadsheet = spreadsheet_();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const currentHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0].map(String)
    : [];
  if (currentHeaders.slice(0, headers.length).join("|") !== headers.join("|")) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function currentSheet_() {
  return sheetWithHeaders_("VaultCurrent", CURRENT_HEADERS);
}

function journalSheet_() {
  return sheetWithHeaders_("VaultJournal", JOURNAL_HEADERS);
}

function bytesToHex_(bytes) {
  return bytes.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0")).join("");
}

function checksum_(payloadText) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payloadText, Utilities.Charset.UTF_8));
}

function jsonPayload_(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Dados do usuário ausentes ou inválidos.");
  const collectionNames = ["accounts", "transactions", "fixedCosts", "cdbs"];
  collectionNames.forEach((name) => {
    if (payload[name] !== undefined && !Array.isArray(payload[name])) throw new Error("Estrutura inválida em " + name + ".");
    if (Array.isArray(payload[name]) && payload[name].length > MAX_ITEMS_PER_COLLECTION) throw new Error("Quantidade de registros excedida em " + name + ".");
  });
  const text = JSON.stringify(payload);
  if (Utilities.newBlob(text).getBytes().length > MAX_PAYLOAD_BYTES) throw new Error("O cofre ultrapassou o limite seguro de armazenamento.");
  return text;
}

function parseRow_(row, kind) {
  const offset = kind === "journal" ? { account: 1, username: 2, revision: 3, updatedAt: 4, checksum: 5, payload: 6 } : { account: 0, username: 1, revision: 2, updatedAt: 3, checksum: 4, payload: 5 };
  const payloadText = String(row[offset.payload] || "");
  if (!payloadText || checksum_(payloadText) !== String(row[offset.checksum] || "")) return null;
  let payload;
  try { payload = JSON.parse(payloadText); } catch (error) { return null; }
  return {
    accountId: String(row[offset.account] || ""),
    username: String(row[offset.username] || "").toLowerCase(),
    revision: Number(row[offset.revision] || 0),
    updatedAt: row[offset.updatedAt],
    checksum: String(row[offset.checksum] || ""),
    payload
  };
}

function currentRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, CURRENT_HEADERS.length).getValues();
}

function latestJournal_(identity) {
  const sheet = journalSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const rows = sheet.getRange(2, 1, lastRow - 1, JOURNAL_HEADERS.length).getValues();
  return rows.map((row) => parseRow_(row, "journal"))
    .filter((row) => row && row.accountId === identity.accountId)
    .sort((a, b) => b.revision - a.revision)[0] || null;
}

function getVault_(identity) {
  const sheet = currentSheet_();
  const match = currentRows_(sheet).map((row) => parseRow_(row, "current"))
    .find((row) => row && row.accountId === identity.accountId);
  if (match) return { ok: true, username: identity.username, revision: match.revision, updatedAt: match.updatedAt, payload: match.payload, recovered: false };
  const recovered = latestJournal_(identity);
  if (recovered) return { ok: true, username: identity.username, revision: recovered.revision, updatedAt: recovered.updatedAt, payload: recovered.payload, recovered: true };
  return { ok: true, username: identity.username, revision: 0, payload: null, recovered: false };
}

function backupName_(identity, revision) {
  return "backup-" + checksum_(identity.accountId).slice(0, 16) + "-r" + revision + "-" + Utilities.formatDate(new Date(), "UTC", "yyyyMMdd-HHmmss") + ".json";
}

function writeDriveSnapshot_(identity, revision, updatedAt, checksum, payload) {
  const content = JSON.stringify({
    service: "minha-contabilidade",
    accountHash: checksum_(identity.accountId),
    revision,
    updatedAt,
    checksum,
    payload
  }, null, 2);
  folder_().createFile(backupName_(identity, revision), content, MimeType.PLAIN_TEXT);
  return true;
}

function saveVault_(identity, payload, baseRevision) {
  const payloadText = jsonPayload_(payload);
  const checksum = checksum_(payloadText);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = currentSheet_();
    const journal = journalSheet_();
    const rows = currentRows_(sheet);
    const currentIndex = rows.findIndex((row) => String(row[0] || "") === identity.accountId);
    const current = currentIndex >= 0 ? parseRow_(rows[currentIndex], "current") : null;
    const expectedRevision = Number(baseRevision);
    if (Number.isFinite(expectedRevision) && expectedRevision >= 0 && (current?.revision || 0) !== expectedRevision) {
      throw new Error("Este cadastro foi alterado em outro dispositivo. Atualize a página antes de salvar novamente.");
    }
    const revision = (current?.revision || 0) + 1;
    const updatedAt = new Date().toISOString();
    const journalId = Utilities.getUuid();

    // O journal é gravado primeiro. Se a atualização seguinte falhar, o estado
    // válido mais recente ainda pode ser reconstruído por latestJournal_().
    journal.appendRow([journalId, identity.accountId, identity.username, revision, updatedAt, checksum, payloadText, "sync"]);
    const currentValues = [[identity.accountId, identity.username, revision, updatedAt, checksum, payloadText]];
    if (currentIndex < 0) sheet.getRange(sheet.getLastRow() + 1, 1, 1, CURRENT_HEADERS.length).setValues(currentValues);
    else sheet.getRange(currentIndex + 2, 1, 1, CURRENT_HEADERS.length).setValues(currentValues);

    let backupCreated = false;
    let backupWarning = "";
    try {
      backupCreated = writeDriveSnapshot_(identity, revision, updatedAt, checksum, payload);
    } catch (error) {
      // O estado atual e o journal já estão persistidos; o aviso não desfaz a gravação.
      backupWarning = "O snapshot do Drive não foi criado nesta tentativa.";
    }
    return { ok: true, username: identity.username, revision, updatedAt, checksum, backupCreated, backupWarning };
  } finally {
    lock.releaseLock();
  }
}
