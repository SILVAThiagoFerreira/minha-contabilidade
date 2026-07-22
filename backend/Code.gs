/**
 * Backend online de Minha Contabilidade.
 *
 * O Web App executa como o proprietário e nunca entrega a planilha ao
 * navegador. O cadastro, a senha, o cofre e o histórico persistem somente
 * no Google Sheets.
 */
const DEFAULT_CONFIG = {
  spreadsheetId: ""
};

const USER_HEADERS = ["accountId", "username", "displayName", "salt", "verifier", "createdAt", "updatedAt", "status"];
const CURRENT_HEADERS = ["accountId", "username", "revision", "updatedAt", "checksum", "payload"];
const JOURNAL_HEADERS = ["journalId", "accountId", "username", "revision", "updatedAt", "checksum", "payload", "source"];
const MAX_PAYLOAD_CHARS = 45000;
const MAX_ITEMS_PER_COLLECTION = 10000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function doGet() {
  return json_({ ok: true, service: "minha-contabilidade", storage: "Google Sheets: Users + VaultCurrent + VaultJournal" });
}

function doPost(event) {
  try {
    const body = JSON.parse(event && event.postData && event.postData.contents || "{}");
    const action = String(body.action || "").trim().toLowerCase();
    if (action === "register") return json_(register_(body));
    const identity = authenticate_(body);
    if (action === "login") return json_(login_(identity));
    if (action === "get") return json_(getVault_(identity));
    if (action === "sync") return json_(saveVault_(identity, body.payload, body.baseRevision));
    return json_({ ok: false, error: "Ação não reconhecida." }, 400);
  } catch (error) {
    return json_({ ok: false, error: error.message || "Falha no backend." }, 400);
  }
}

function json_(payload, statusCode) {
  return ContentService.createTextOutput(JSON.stringify({ ...payload, statusCode: statusCode || 200 }))
    .setMimeType(ContentService.MimeType.JSON);
}

function config_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: properties.getProperty("SPREADSHEET_ID") || DEFAULT_CONFIG.spreadsheetId
  };
}

function identity_(body) {
  const username = String(body.username || "").trim().toLowerCase();
  const accountId = String(body.accountId || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("Usuário inválido.");
  if (!/^[a-f0-9]{64}$/.test(accountId) || accountId !== checksum_(username)) throw new Error("Identidade inválida.");
  return { accountId, username };
}

function password_(body) {
  const password = String(body.password || "");
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) throw new Error("A senha deve ter entre 8 e 128 caracteres.");
  return password;
}

function displayName_(value, fallback) {
  const displayName = String(value || fallback || "").trim().slice(0, 80);
  return displayName || fallback;
}

function spreadsheet_() {
  const config = config_();
  if (!config.spreadsheetId) throw new Error("SPREADSHEET_ID não configurado. O sistema não criará outra planilha.");
  return SpreadsheetApp.openById(config.spreadsheetId);
}

function sheetWithHeaders_(name, headers) {
  const spreadsheet = spreadsheet_();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const lastColumn = sheet.getLastColumn();
  const currentHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, Math.max(lastColumn, headers.length)).getValues()[0].map(String)
    : [];
  if (!currentHeaders.length || currentHeaders.every((value) => !value)) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (currentHeaders.slice(0, headers.length).join("|") !== headers.join("|")) {
    throw new Error("Schema inesperado na aba " + name + ". Nenhum dado foi alterado.");
  }
  return sheet;
}

function usersSheet_() {
  return sheetWithHeaders_("Users", USER_HEADERS);
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

function checksum_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
}

function passwordVerifier_(salt, password) {
  return checksum_(String(salt) + ":" + password);
}

function userRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, USER_HEADERS.length).getValues();
}

function parseUser_(row) {
  return {
    accountId: String(row[0] || ""),
    username: String(row[1] || "").toLowerCase(),
    displayName: String(row[2] || ""),
    salt: String(row[3] || ""),
    verifier: String(row[4] || ""),
    createdAt: row[5],
    updatedAt: row[6],
    status: String(row[7] || "active").toLowerCase()
  };
}

function findUser_(identity) {
  return userRows_(usersSheet_()).map((row, index) => ({ user: parseUser_(row), rowNumber: index + 2 }))
    .find((item) => item.user.accountId === identity.accountId && item.user.username === identity.username) || null;
}

function register_(body) {
  const identity = identity_(body);
  const password = password_(body);
  const displayName = displayName_(body.displayName, identity.username);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = usersSheet_();
    const existing = userRows_(sheet).map(parseUser_).find((user) => user.accountId === identity.accountId || user.username === identity.username);
    if (existing) throw new Error("Esse usuário já existe.");
    const salt = Utilities.getUuid();
    const now = new Date().toISOString();
    sheet.appendRow([identity.accountId, identity.username, displayName, salt, passwordVerifier_(salt, password), now, now, "active"]);
    return { ok: true, accountId: identity.accountId, username: identity.username, displayName, revision: 0, payload: null, recovered: false };
  } finally {
    lock.releaseLock();
  }
}

function authenticate_(body) {
  const identity = identity_(body);
  const password = password_(body);
  const match = findUser_(identity);
  if (!match || match.user.status !== "active" || passwordVerifier_(match.user.salt, password) !== match.user.verifier) {
    throw new Error("Usuário ou senha inválidos.");
  }
  return { ...identity, displayName: match.user.displayName };
}

function login_(identity) {
  const vault = getVault_(identity);
  return { ...vault, displayName: identity.displayName };
}

function blankVault_(displayName) {
  return {
    version: 1,
    profile: { displayName: displayName || "", currency: "BRL" },
    accounts: [],
    debts: [],
    transactions: [],
    fixedCosts: [],
    transfers: [],
    fixedCostPayments: [],
    cdbs: [],
    investments: [],
    savings: [],
    updatedAt: new Date().toISOString()
  };
}

function jsonPayload_(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Dados do usuário ausentes ou inválidos.");
  ["accounts", "debts", "transactions", "fixedCosts", "transfers", "fixedCostPayments", "cdbs", "investments", "savings"].forEach((name) => {
    if (payload[name] !== undefined && !Array.isArray(payload[name])) throw new Error("Estrutura inválida em " + name + ".");
    if (Array.isArray(payload[name]) && payload[name].length > MAX_ITEMS_PER_COLLECTION) throw new Error("Quantidade de registros excedida em " + name + ".");
  });
  validateInvestmentOperations_(payload.investments || [], payload.transactions || []);
  validateTransfers_(payload.transfers || [], payload.transactions || [], payload.accounts || []);
  validateFixedCostPayments_(payload.fixedCostPayments || [], payload.fixedCosts || []);
  const text = JSON.stringify(payload);
  if (text.length > MAX_PAYLOAD_CHARS) throw new Error("O cofre ultrapassou o limite seguro da planilha.");
  return text;
}

/**
 * Transferências são dados adicionais ao histórico: o movimento financeiro
 * continua em transactions, mas as duas linhas precisam carregar o mesmo
 * transferId e os papéis "origem"/"destino". A coleção transfers é opcional
 * para manter compatibilidade com payloads que usam somente esse vínculo nas
 * transações; quando presente, ela descreve a origem, o destino e o valor.
 */
function validateTransfers_(transfers, transactions, accounts) {
  const transferById = Object.create(null);
  const transactionGroups = Object.create(null);
  const accountIds = Object.create(null);

  if (Array.isArray(accounts)) {
    accounts.forEach((account) => {
      if (account && typeof account === "object" && String(account.id || "")) accountIds[String(account.id)] = true;
    });
  }

  transfers.forEach((transfer) => {
    if (!transfer || typeof transfer !== "object" || Array.isArray(transfer)) throw new Error("Transferência inválida.");
    const id = String(transfer.id || "").trim();
    const fromAccountId = String(transfer.sourceAccountId || transfer.fromAccountId || "").trim();
    const toAccountId = String(transfer.destinationAccountId || transfer.toAccountId || "").trim();
    const amount = Number(transfer.amount);
    if (!id || transferById[id]) throw new Error("Cada transferência precisa ter um ID único.");
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) throw new Error("A transferência precisa ligar duas contas diferentes.");
    if (!isFinite(amount) || amount <= 0) throw new Error("O valor da transferência precisa ser maior que zero.");
    if (!String(transfer.date || "").trim()) throw new Error("A transferência precisa ter uma data.");
    if (Object.keys(accountIds).length && (!accountIds[fromAccountId] || !accountIds[toAccountId])) throw new Error("A transferência referencia uma conta inexistente.");
    transferById[id] = { fromAccountId, toAccountId, amount };
  });

  transactions.forEach((transaction) => {
    if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) return;
    const transferId = String(transaction.transferId || "").trim();
    if (!transferId) return;
    const roleValue = String(transaction.transferRole || "").trim().toLowerCase();
    const role = roleValue === "origem" || roleValue === "saida" ? "saida" : roleValue === "destino" || roleValue === "entrada" ? "entrada" : "";
    const type = String(transaction.type || "").trim().toLowerCase();
    const amount = Number(transaction.amount);
    if (!role) throw new Error("O papel da transação de transferência deve ser origem/saída ou destino/entrada.");
    if (type !== role) throw new Error("O tipo da transação não confere com o papel da transferência.");
    if (!String(transaction.accountId || "").trim() || !isFinite(amount) || amount <= 0) throw new Error("A transação de transferência precisa indicar conta e valor válido.");
    if (!transactionGroups[transferId]) transactionGroups[transferId] = { saida: null, entrada: null };
    if (transactionGroups[transferId][role]) throw new Error("Uma transferência não pode ter duas transações do mesmo papel.");
    transactionGroups[transferId][role] = { accountId: String(transaction.accountId).trim(), amount };
  });

  Object.keys(transactionGroups).forEach((transferId) => {
    const group = transactionGroups[transferId];
    if (!group.saida || !group.entrada) throw new Error("Toda transferência precisa ter uma saída e uma entrada.");
    if (group.saida.accountId === group.entrada.accountId || Math.abs(group.saida.amount - group.entrada.amount) > 0.005) throw new Error("A saída e a entrada da transferência precisam ter contas diferentes e o mesmo valor.");
    const transfer = transferById[transferId];
    if (transfer && (group.saida.accountId !== transfer.fromAccountId || group.entrada.accountId !== transfer.toAccountId || Math.abs(group.saida.amount - transfer.amount) > 0.005)) throw new Error("As transações não conferem com a transferência informada.");
  });

  Object.keys(transferById).forEach((transferId) => {
    if (!transactionGroups[transferId]) throw new Error("A transferência precisa ter as transações de saída e entrada correspondentes.");
  });
}

/**
 * A agenda é uma referência mensal, não um lançamento contábil. Cada custo
 * fixo pode ter no máximo uma marcação por mês; completed só registra a
 * conclusão e não é convertido em transaction.
 */
function validateFixedCostPayments_(payments, fixedCosts) {
  const paymentIds = Object.create(null);
  const paymentByMonth = Object.create(null);
  const fixedCostIds = Object.create(null);
  (fixedCosts || []).forEach((fixedCost) => {
    if (fixedCost && typeof fixedCost === "object" && String(fixedCost.id || "").trim()) fixedCostIds[String(fixedCost.id).trim()] = true;
  });
  payments.forEach((payment) => {
    if (!payment || typeof payment !== "object" || Array.isArray(payment)) throw new Error("Registro de agenda de custo fixo inválido.");
    const id = String(payment.id || "").trim();
    const fixedCostId = String(payment.fixedCostId || "").trim();
    const period = String(payment.period || payment.month || "").trim();
    if (!id || paymentIds[id]) throw new Error("Cada registro da agenda precisa ter um ID único.");
    if (!fixedCostId) throw new Error("O registro da agenda precisa indicar o custo fixo.");
    if (Object.keys(fixedCostIds).length && !fixedCostIds[fixedCostId]) throw new Error("O registro da agenda referencia um custo fixo inexistente.");
    if (payment.period !== undefined && payment.month !== undefined && String(payment.period).trim() !== String(payment.month).trim()) throw new Error("O período do custo fixo está duplicado com valores diferentes.");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("O período do custo fixo deve estar no formato AAAA-MM.");
    if (payment.completed !== undefined && typeof payment.completed !== "boolean") throw new Error("A conclusão do custo fixo deve ser booleana.");
    if (payment.completedAt !== undefined && payment.completedAt !== null && !String(payment.completedAt).trim()) throw new Error("A data de conclusão do custo fixo é inválida.");
    const monthKey = fixedCostId + "|" + period;
    if (paymentByMonth[monthKey]) throw new Error("Já existe uma marcação para este custo fixo neste mês.");
    paymentIds[id] = true;
    paymentByMonth[monthKey] = true;
  });
}

function validateInvestmentOperations_(investments, transactions) {
  const operationIds = {};
  const investmentByOperation = {};
  investments.forEach((investment) => {
    if (!investment || typeof investment !== "object") throw new Error("Investimento inválido.");
    const operations = investment.operations === undefined ? [] : investment.operations;
    if (!Array.isArray(operations)) throw new Error("Histórico de movimentações inválido no investimento.");
    if (operations.length > MAX_ITEMS_PER_COLLECTION) throw new Error("Quantidade de movimentações excedida no investimento.");
    operations.forEach((operation) => {
      if (!operation || typeof operation !== "object") throw new Error("Movimentação de investimento inválida.");
      const operationId = String(operation.id || "");
      const operationType = String(operation.type || "");
      const amount = Number(operation.amount);
      if (!operationId || operationIds[operationId]) throw new Error("Cada movimentação de investimento precisa ter um ID único.");
      if (["aporte", "resgate", "rendimento"].indexOf(operationType) === -1) throw new Error("Tipo de movimentação de investimento inválido.");
      if (!isFinite(amount) || amount <= 0) throw new Error("O valor da movimentação precisa ser maior que zero.");
      if (!String(operation.date || "")) throw new Error("A movimentação de investimento precisa ter uma data.");
      if ((operationType === "aporte" || operationType === "resgate") && !String(operation.accountId || "")) throw new Error("Aporte e resgate precisam indicar a conta do movimento.");
      if (operation.balanceAfter !== undefined && (!isFinite(Number(operation.balanceAfter)) || Number(operation.balanceAfter) < 0)) throw new Error("Saldo posterior da movimentação inválido.");
      if (operation.principalAfter !== undefined && (!isFinite(Number(operation.principalAfter)) || Number(operation.principalAfter) < 0)) throw new Error("Capital posterior da movimentação inválido.");
      if (operation.yieldAfter !== undefined && (!isFinite(Number(operation.yieldAfter)) || Number(operation.yieldAfter) < 0)) throw new Error("Rendimento posterior da movimentação inválido.");
      operationIds[operationId] = true;
      investmentByOperation[operationId] = { investmentId: String(investment.id || ""), operation };
    });
  });
  transactions.forEach((transaction) => {
    const operationId = String(transaction && transaction.investmentOperationId || "");
    if (!operationId) return;
    const linked = investmentByOperation[operationId];
    if (!linked) throw new Error("Lançamento de investimento sem movimentação correspondente.");
    const operation = linked.operation;
    if (operation.type === "rendimento") throw new Error("Rendimento informado não pode criar lançamento de conta.");
    if (String(transaction.investmentId || "") !== linked.investmentId) throw new Error("Lançamento vinculado a investimento incorreto.");
    if (String(transaction.accountId || "") !== String(operation.accountId || "")) throw new Error("Conta do lançamento não confere com a operação.");
    const expectedTransactionType = operation.type === "aporte" ? "saida" : "entrada";
    if (String(transaction.type || "") !== expectedTransactionType || Math.abs(Number(transaction.amount) - Number(operation.amount)) > 0.005) throw new Error("Valor ou tipo do lançamento não confere com a operação.");
    linked.transactionCount = (linked.transactionCount || 0) + 1;
  });
  Object.keys(investmentByOperation).forEach((operationId) => {
    const linked = investmentByOperation[operationId];
    if (linked.operation.type !== "rendimento" && linked.transactionCount !== 1) throw new Error("Aporte e resgate precisam ter exatamente um lançamento de conta.");
    if (linked.operation.type === "rendimento" && linked.transactionCount) throw new Error("Rendimento informado não pode criar lançamento de conta.");
  });
}

function parseRow_(row, kind) {
  const offset = kind === "journal"
    ? { account: 1, username: 2, revision: 3, updatedAt: 4, checksum: 5, payload: 6 }
    : { account: 0, username: 1, revision: 2, updatedAt: 3, checksum: 4, payload: 5 };
  const payloadText = String(row[offset.payload] || "");
  if (!payloadText || checksum_(payloadText) !== String(row[offset.checksum] || "")) return null;
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    return null;
  }
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
    .filter((row) => row && row.accountId === identity.accountId && row.username === identity.username)
    .sort((a, b) => b.revision - a.revision)[0] || null;
}

function repairCurrent_(identity, recovered) {
  const sheet = currentSheet_();
  const rows = currentRows_(sheet);
  const index = rows.findIndex((row) => String(row[0] || "") === identity.accountId);
  const values = [[identity.accountId, identity.username, recovered.revision, recovered.updatedAt, recovered.checksum, JSON.stringify(recovered.payload)]];
  if (index < 0) sheet.getRange(sheet.getLastRow() + 1, 1, 1, CURRENT_HEADERS.length).setValues(values);
  else sheet.getRange(index + 2, 1, 1, CURRENT_HEADERS.length).setValues(values);
}

function getVault_(identity) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = currentSheet_();
    const match = currentRows_(sheet).map((row) => parseRow_(row, "current"))
      .find((row) => row && row.accountId === identity.accountId && row.username === identity.username);
    if (match) return { ok: true, username: identity.username, revision: match.revision, updatedAt: match.updatedAt, payload: match.payload, recovered: false };
    const recovered = latestJournal_(identity);
    if (recovered) {
      repairCurrent_(identity, recovered);
      return { ok: true, username: identity.username, revision: recovered.revision, updatedAt: recovered.updatedAt, payload: recovered.payload, recovered: true };
    }
    return { ok: true, username: identity.username, revision: 0, payload: null, recovered: false };
  } finally {
    lock.releaseLock();
  }
}

function saveVault_(identity, payload, baseRevision) {
  const payloadText = jsonPayload_(payload);
  const checksum = checksum_(payloadText);
  const expectedRevision = Number(baseRevision);
  if (!Number.isFinite(expectedRevision) || expectedRevision < 0) throw new Error("Revisão base inválida.");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = currentSheet_();
    const journal = journalSheet_();
    const rows = currentRows_(sheet);
    const currentIndex = rows.findIndex((row) => String(row[0] || "") === identity.accountId && String(row[1] || "").toLowerCase() === identity.username);
    const current = currentIndex >= 0 ? parseRow_(rows[currentIndex], "current") : null;
    if ((current ? current.revision : 0) !== expectedRevision) throw new Error("Este cadastro foi alterado em outro dispositivo. Atualize a página antes de salvar novamente.");
    const revision = (current ? current.revision : 0) + 1;
    const updatedAt = new Date().toISOString();
    journal.appendRow([Utilities.getUuid(), identity.accountId, identity.username, revision, updatedAt, checksum, payloadText, "sync"]);
    const values = [[identity.accountId, identity.username, revision, updatedAt, checksum, payloadText]];
    if (currentIndex < 0) sheet.getRange(sheet.getLastRow() + 1, 1, 1, CURRENT_HEADERS.length).setValues(values);
    else sheet.getRange(currentIndex + 2, 1, 1, CURRENT_HEADERS.length).setValues(values);
    return { ok: true, username: identity.username, revision, updatedAt, checksum };
  } finally {
    lock.releaseLock();
  }
}
