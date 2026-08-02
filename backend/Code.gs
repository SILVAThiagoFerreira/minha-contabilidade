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

// Novas colunas são sempre acrescentadas ao final para preservar planilhas já
// existentes. `role` é deliberadamente uma autorização de servidor: nunca é
// aceito do navegador nem armazenado dentro do cofre do usuário.
const USER_HEADERS = ["accountId", "username", "displayName", "salt", "verifier", "createdAt", "updatedAt", "status", "role"];
const CURRENT_HEADERS = ["accountId", "username", "revision", "updatedAt", "checksum", "payload"];
const JOURNAL_HEADERS = ["journalId", "accountId", "username", "revision", "updatedAt", "checksum", "payload", "source"];
const ACCESS_HEADERS = ["accessId", "accountId", "username", "accessedAt", "event"];
const PASSWORD_RESET_HEADERS = ["resetId", "accountId", "username", "tokenHash", "createdAt", "expiresAt", "usedAt"];
// O limite por célula do Google Sheets é 50 mil caracteres. Este teto mantém
// uma margem operacional e permite que cofres extensos continuem aceitando um
// avatar compactado sem ultrapassar a capacidade da planilha.
const MAX_PAYLOAD_CHARS = 49000;
const MAX_ITEMS_PER_COLLECTION = 10000;
const MAX_CUSTOM_CATEGORIES = 100;
const MAX_CUSTOM_CATEGORY_NAME_LENGTH = 50;
const MAX_PROFILE_PHOTO_CHARS = 26000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_RATE_LIMIT_MS = 60 * 1000;

function doGet() {
  return json_({ ok: true, service: "minha-contabilidade", storage: "Google Sheets: Users + VaultCurrent + VaultJournal" });
}

function doPost(event) {
  try {
    const body = JSON.parse(event && event.postData && event.postData.contents || "{}");
    const action = String(body.action || "").trim().toLowerCase();
    if (action === "register") return json_(register_(body));
    if (action === "request-password-reset") return json_(requestPasswordReset_(body));
    if (action === "confirm-password-reset") return json_(confirmPasswordReset_(body));
    const identity = authenticate_(body);
    if (action === "login") { recordAccess_(identity, "login"); return json_(login_(identity)); }
    if (action === "change-password") return json_(changePassword_(identity, body.payload && body.payload.newPassword || body.newPassword));
    if (action === "get") return json_(getVault_(identity));
    if (action === "sync") return json_(saveVault_(identity, body.payload, body.baseRevision));
    if (action === "admin-dashboard") return json_(adminDashboard_(identity));
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
  return validatePassword_(body.password);
}

function validatePassword_(value) {
  const password = String(value || "");
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
  while (currentHeaders.length && !currentHeaders[currentHeaders.length - 1]) currentHeaders.pop();
  if (!currentHeaders.length || currentHeaders.every((value) => !value)) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (currentHeaders.slice(0, Math.min(currentHeaders.length, headers.length)).join("|") !== headers.slice(0, currentHeaders.length).join("|")) {
    throw new Error("Schema inesperado na aba " + name + ". Nenhum dado foi alterado.");
  } else if (currentHeaders.length < headers.length) {
    // Migração compatível: apenas acrescenta campos opcionais, sem deslocar
    // nem reescrever os registros históricos.
    sheet.getRange(1, currentHeaders.length + 1, 1, headers.length - currentHeaders.length)
      .setValues([headers.slice(currentHeaders.length)]);
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

function accessSheet_() {
  return sheetWithHeaders_("AccessLog", ACCESS_HEADERS);
}

function passwordResetSheet_() {
  return sheetWithHeaders_("PasswordResets", PASSWORD_RESET_HEADERS);
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
    status: String(row[7] || "active").toLowerCase(),
    role: String(row[8] || "user").toLowerCase() === "admin" ? "admin" : "user"
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
    sheet.appendRow([identity.accountId, identity.username, displayName, salt, passwordVerifier_(salt, password), now, now, "active", "user"]);
    recordAccess_(identity, "register");
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
  return { ...identity, displayName: match.user.displayName, role: match.user.role };
}

function identityFromUsername_(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("Informe um usuário válido.");
  return { username, accountId: checksum_(username) };
}

function requireAdmin_(identity) {
  if (identity.role !== "admin") throw new Error("Acesso administrativo não autorizado.");
}

/**
 * Provisiona, uma única vez, um administrador definido somente nas Script
 * Properties. Execute manualmente no editor Apps Script. A senha temporária é
 * removida da propriedade após o uso e jamais deve constar neste arquivo.
 *
 * Propriedades exigidas: ADMIN_USERNAME, ADMIN_PASSWORD.
 * Opcional: ADMIN_DISPLAY_NAME.
 */
function provisionAdminFromScriptProperties() {
  const properties = PropertiesService.getScriptProperties();
  const username = String(properties.getProperty("ADMIN_USERNAME") || "").trim().toLowerCase();
  const password = validatePassword_(properties.getProperty("ADMIN_PASSWORD"));
  const displayName = displayName_(properties.getProperty("ADMIN_DISPLAY_NAME"), username);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error("ADMIN_USERNAME inválido.");
  const identity = { username, accountId: checksum_(username) };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = usersSheet_();
    const found = userRows_(sheet).map((row, index) => ({ user: parseUser_(row), rowNumber: index + 2 }))
      .find((item) => item.user.username === username || item.user.accountId === identity.accountId);
    const salt = Utilities.getUuid();
    const now = new Date().toISOString();
    const verifier = passwordVerifier_(salt, password);
    if (found) {
      // O provisionamento é explícito e atualiza somente a conta escolhida.
      sheet.getRange(found.rowNumber, 3, 1, 7)
        .setValues([[displayName, salt, verifier, found.user.createdAt || now, now, "active", "admin"]]);
    } else {
      sheet.appendRow([identity.accountId, username, displayName, salt, verifier, now, now, "active", "admin"]);
    }
    properties.deleteProperty("ADMIN_PASSWORD");
    return { ok: true, username, role: "admin", provisionedAt: now };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Promove uma conta já existente sem alterar sua senha. Defina somente
 * ADMIN_PROMOTE_USERNAME nas Script Properties, execute esta função e remova
 * a propriedade depois. É a opção apropriada para conceder administração ao
 * proprietário atual da contabilidade.
 */
function promoteExistingAdminFromScriptProperties() {
  const properties = PropertiesService.getScriptProperties();
  const identity = identityFromUsername_(properties.getProperty("ADMIN_PROMOTE_USERNAME"));
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const match = findUser_(identity);
    if (!match || match.user.status !== "active") throw new Error("Usuário ativo não encontrado para promoção.");
    usersSheet_().getRange(match.rowNumber, 9).setValue("admin");
    properties.deleteProperty("ADMIN_PROMOTE_USERNAME");
    return { ok: true, username: identity.username, role: "admin", promotedAt: new Date().toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function changePassword_(identity, newPasswordValue) {
  const newPassword = validatePassword_(newPasswordValue);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const match = findUser_(identity);
    if (!match || match.user.status !== "active") throw new Error("Usuário não encontrado ou inativo.");
    const salt = Utilities.getUuid();
    const now = new Date().toISOString();
    const sheet = usersSheet_();
    sheet.getRange(match.rowNumber, 4, 1, 4).setValues([[salt, passwordVerifier_(salt, newPassword), match.user.createdAt, now]]);
    return { ok: true, username: identity.username, passwordChangedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function vaultForAccount_(identity) {
  const row = currentRows_(currentSheet_()).map((item) => parseRow_(item, "current")).find((item) => item && item.accountId === identity.accountId && item.username === identity.username);
  return row && row.payload && typeof row.payload === "object" ? row.payload : null;
}

function resetRows_() {
  const sheet = passwordResetSheet_();
  const lastRow = sheet.getLastRow();
  return lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, PASSWORD_RESET_HEADERS.length).getValues();
}

function passwordResetUrl_(username, token) {
  const appUrl = String(PropertiesService.getScriptProperties().getProperty("APP_PUBLIC_URL") || "").trim();
  if (!/^https:\/\//i.test(appUrl)) throw new Error("O serviço de recuperação ainda não foi configurado.");
  return appUrl.replace(/#.*$/, "") + "#recuperar?u=" + encodeURIComponent(username) + "&t=" + encodeURIComponent(token);
}

function requestPasswordReset_(body) {
  const identity = identityFromUsername_(body.username);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const match = findUser_(identity);
    // Para evitar enumeração, contas inexistentes e inativas recebem a mesma
    // resposta neutra das contas com e-mail configurado.
    if (!match || match.user.status !== "active") return { ok: true, status: "sent_if_available" };
    const profile = vaultForAccount_(identity)?.profile || {};
    const email = String(profile.email || "").trim();
    if (!email) return { ok: true, status: "email_missing" };
    const properties = PropertiesService.getScriptProperties();
    const rateKey = "PASSWORD_RESET_LAST_" + checksum_(identity.username);
    const lastRequestAt = Number(properties.getProperty(rateKey) || 0);
    const nowMs = Date.now();
    if (nowMs - lastRequestAt < PASSWORD_RESET_RATE_LIMIT_MS) return { ok: true, status: "sent_if_available" };
    const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    const now = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + PASSWORD_RESET_TTL_MS).toISOString();
    passwordResetSheet_().appendRow([Utilities.getUuid(), identity.accountId, identity.username, checksum_(token), now, expiresAt, ""]);
    properties.setProperty(rateKey, String(nowMs));
    const resetUrl = passwordResetUrl_(identity.username, token);
    MailApp.sendEmail({
      to: email,
      subject: "Recuperação de acesso — Minha Contabilidade",
      htmlBody: "<p>Recebemos um pedido para redefinir sua senha.</p><p><a href=\"" + resetUrl + "\">Redefinir minha senha</a></p><p>Este link expira em 30 minutos e pode ser usado apenas uma vez. Se você não fez este pedido, ignore este e-mail.</p>",
      body: "Recebemos um pedido para redefinir sua senha. Abra este link em até 30 minutos: " + resetUrl + "\n\nSe você não fez este pedido, ignore este e-mail."
    });
    return { ok: true, status: "sent_if_available" };
  } finally {
    lock.releaseLock();
  }
}

function confirmPasswordReset_(body) {
  const identity = identityFromUsername_(body.username);
  const token = String(body.token || "").trim();
  const newPassword = validatePassword_(body.newPassword);
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("Link de recuperação inválido.");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const match = findUser_(identity);
    if (!match || match.user.status !== "active") throw new Error("Link de recuperação inválido ou expirado.");
    const tokenHash = checksum_(token);
    const reset = resetRows_().map((row, index) => ({
      rowNumber: index + 2,
      accountId: String(row[1] || ""), username: String(row[2] || "").toLowerCase(), tokenHash: String(row[3] || ""), expiresAt: String(row[5] || ""), usedAt: String(row[6] || "")
    })).find((item) => item.accountId === identity.accountId && item.username === identity.username && item.tokenHash === tokenHash && !item.usedAt && Date.parse(item.expiresAt) > Date.now());
    if (!reset) throw new Error("Link de recuperação inválido ou expirado.");
    const now = new Date().toISOString();
    const salt = Utilities.getUuid();
    usersSheet_().getRange(match.rowNumber, 4, 1, 4).setValues([[salt, passwordVerifier_(salt, newPassword), match.user.createdAt, now]]);
    passwordResetSheet_().getRange(reset.rowNumber, 7).setValue(now);
    recordAccess_(identity, "password-reset");
    return { ok: true, passwordChangedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function login_(identity) {
  const vault = getVault_(identity);
  return { ...vault, displayName: identity.displayName, role: identity.role };
}

function recordAccess_(identity, eventName) {
  accessSheet_().appendRow([Utilities.getUuid(), identity.accountId, identity.username, new Date().toISOString(), String(eventName || "login")]);
}

function accessRows_() {
  const sheet = accessSheet_();
  const lastRow = sheet.getLastRow();
  return lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, ACCESS_HEADERS.length).getValues();
}

function adminDashboard_(identity) {
  requireAdmin_(identity);
  const users = userRows_(usersSheet_()).map(parseUser_);
  const current = currentRows_(currentSheet_()).map((row) => parseRow_(row, "current")).filter(Boolean);
  const journalRows = journalSheet_().getLastRow();
  const accessRows = accessRows_();
  const now = new Date();
  const currentMonth = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM");
  const visitsByMonth = Object.create(null);
  const lastLoginByAccount = Object.create(null);
  accessRows.forEach((row) => {
    const accessedAt = String(row[3] || "");
    const month = accessedAt.slice(0, 7);
    if (month) visitsByMonth[month] = (visitsByMonth[month] || 0) + 1;
    const accountId = String(row[1] || "");
    if (accountId && (!lastLoginByAccount[accountId] || accessedAt > lastLoginByAccount[accountId])) lastLoginByAccount[accountId] = accessedAt;
  });
  const metrics = {
    generatedAt: new Date().toISOString(),
    totalUsers: users.length,
    activeUsers: users.filter((user) => user.status === "active").length,
    inactiveUsers: users.filter((user) => user.status !== "active").length,
    administrators: users.filter((user) => user.role === "admin").length,
    vaultsWithData: current.length,
    totalRevisions: Math.max(0, journalRows - 1),
    transactionRecords: 0,
    accountRecords: 0,
    investmentRecords: 0,
    latestVaultUpdateAt: null
  };
  current.forEach((vault) => {
    const payload = vault.payload || {};
    metrics.transactionRecords += Array.isArray(payload.transactions) ? payload.transactions.length : 0;
    metrics.accountRecords += Array.isArray(payload.accounts) ? payload.accounts.length : 0;
    metrics.investmentRecords += Array.isArray(payload.investments) ? payload.investments.length : 0;
    const updatedAt = String(vault.updatedAt || "");
    if (updatedAt && (!metrics.latestVaultUpdateAt || updatedAt > metrics.latestVaultUpdateAt)) metrics.latestVaultUpdateAt = updatedAt;
  });
  const safeUsers = users
    .map((user) => ({
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      role: user.role,
      createdAt: user.createdAt || null,
      updatedAt: user.updatedAt || null,
      lastLoginAt: lastLoginByAccount[user.accountId] || null
    }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, 500);
  const months = [];
  for (let offset = 11; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM");
    months.push({ label: Utilities.formatDate(date, Session.getScriptTimeZone(), "MM/yy"), visits: visitsByMonth[key] || 0 });
  }
  const dashboard = {
    generatedAt: metrics.generatedAt,
    summary: {
      visits: accessRows.length,
      users: metrics.totalUsers,
      activeUsers: metrics.activeUsers,
      newUsers: users.filter((user) => String(user.createdAt || "").slice(0, 7) === currentMonth).length
    },
    activity: months,
    users: safeUsers.map((user) => ({ username: user.username, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, active: user.status === "active" })),
    system: [
      { label: "Cofres sincronizados", status: "ok", detail: String(metrics.vaultsWithData) },
      { label: "Revisões preservadas", status: "ok", detail: String(metrics.totalRevisions) },
      { label: "Lançamentos registrados", status: "ok", detail: String(metrics.transactionRecords) },
      { label: "Contas cadastradas", status: "ok", detail: String(metrics.accountRecords) },
      { label: "Investimentos cadastrados", status: "ok", detail: String(metrics.investmentRecords) }
    ]
  };
  return { ok: true, dashboard };
}

function blankVault_(displayName) {
  return {
    version: 1,
    profile: { displayName: displayName || "", email: "", avatarDataUrl: "", currency: "BRL", monthlySalary: 0, averageMonthlySalaryWithOvertime: 0, customCategories: [] },
    accounts: [],
    debts: [],
    transactions: [],
    fixedCosts: [],
    transfers: [],
    fixedCostPayments: [],
    cdbs: [],
    investments: [],
    patrimony: [],
    savings: [],
    updatedAt: new Date().toISOString()
  };
}

function jsonPayload_(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Dados do usuário ausentes ou inválidos.");
  validateProfile_(payload.profile);
  validateCustomCategories_(payload.profile && payload.profile.customCategories);
  ["accounts", "debts", "transactions", "fixedCosts", "transfers", "fixedCostPayments", "cdbs", "investments", "patrimony", "savings"].forEach((name) => {
    if (payload[name] !== undefined && !Array.isArray(payload[name])) throw new Error("Estrutura inválida em " + name + ".");
    if (Array.isArray(payload[name]) && payload[name].length > MAX_ITEMS_PER_COLLECTION) throw new Error("Quantidade de registros excedida em " + name + ".");
  });
  validateInvestmentOperations_(payload.investments || [], payload.transactions || []);
  validateTransfers_(payload.transfers || [], payload.transactions || [], payload.accounts || []);
  validateFixedCostPayments_(payload.fixedCostPayments || [], payload.fixedCosts || []);
  validateDebts_(payload.debts || [], payload.accounts || []);
  validatePatrimony_(payload.patrimony || []);
  const text = JSON.stringify(payload);
  if (text.length > MAX_PAYLOAD_CHARS) throw new Error("O cofre ultrapassou o limite seguro da planilha.");
  return text;
}

function validateProfile_(profile) {
  if (profile === undefined) return;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("Perfil inválido.");
  const displayName = String(profile.displayName || "").trim();
  const email = String(profile.email || "").trim();
  const photo = String(profile.avatarDataUrl || "");
  if (displayName.length > 80) throw new Error("O nome do perfil pode ter no máximo 80 caracteres.");
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("O e-mail do perfil é inválido.");
  if (photo && (photo.length > MAX_PROFILE_PHOTO_CHARS || !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(photo))) throw new Error("A foto do perfil é inválida ou excede o limite seguro.");
}

function validateCustomCategories_(categories) {
  if (categories === undefined) return;
  if (!Array.isArray(categories)) throw new Error("A lista de categorias personalizadas é inválida.");
  if (categories.length > MAX_CUSTOM_CATEGORIES) throw new Error("A quantidade de categorias personalizadas excede o limite permitido.");
  const ids = Object.create(null);
  const names = Object.create(null);
  categories.forEach((category) => {
    if (!category || typeof category !== "object" || Array.isArray(category)) throw new Error("Categoria personalizada inválida.");
    const id = String(category.id || "").trim();
    const name = String(category.name || "").trim().replace(/\s+/g, " ");
    const nameKey = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(id) || ids[id]) throw new Error("Cada categoria personalizada precisa ter um ID único e válido.");
    if (!name || name.length > MAX_CUSTOM_CATEGORY_NAME_LENGTH || names[nameKey]) throw new Error("Cada categoria personalizada precisa ter um nome único de até 50 caracteres.");
    ids[id] = true;
    names[nameKey] = true;
  });
}

function validateDebts_(debts, accounts) {
  const debtIds = Object.create(null);
  const accountIds = Object.create(null);
  (accounts || []).forEach((account) => {
    if (account && typeof account === "object" && String(account.id || "").trim()) accountIds[String(account.id).trim()] = true;
  });
  (debts || []).forEach((debt) => {
    if (!debt || typeof debt !== "object" || Array.isArray(debt)) throw new Error("Dívida inválida.");
    const id = String(debt.id || "").trim();
    const name = String(debt.name || "").trim();
    const accountId = String(debt.accountId || "").trim();
    const balance = Number(debt.balance);
    const installment = debt.installment === undefined || debt.installment === null || debt.installment === "" ? 0 : Number(debt.installment);
    const dueDay = debt.dueDay === undefined || debt.dueDay === null || debt.dueDay === "" ? null : Number(debt.dueDay);
    if (!id || debtIds[id]) throw new Error("Cada dívida precisa ter um ID único.");
    if (!name) throw new Error("Cada dívida precisa ter uma descrição.");
    if (!isFinite(balance) || balance < 0) throw new Error("O saldo atual da dívida precisa ser maior ou igual a zero.");
    if (!isFinite(installment) || installment < 0) throw new Error("A parcela mensal da dívida precisa ser maior ou igual a zero.");
    if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) throw new Error("O vencimento da dívida deve ficar entre os dias 1 e 31.");
    if (accountId && Object.keys(accountIds).length && !accountIds[accountId]) throw new Error("A dívida referencia uma conta inexistente.");
    if (debt.active !== undefined && typeof debt.active !== "boolean") throw new Error("O status ativo da dívida deve ser booleano.");
    debtIds[id] = true;
  });
}

function validatePatrimony_(items) {
  (items || []).forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Bem patrimonial inválido.");
    if (!String(item.name || "").trim()) throw new Error("Cada bem patrimonial precisa ter um nome.");
    const value = Number(item.currentValue);
    if (!isFinite(value) || value < 0) throw new Error("O valor do bem patrimonial precisa ser maior ou igual a zero.");
  });
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
