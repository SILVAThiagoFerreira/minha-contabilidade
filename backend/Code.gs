/**
 * Backend opcional para o modo online de Minha contabilidade.
 *
 * O script deve ser implantado como um Web App a partir da planilha escolhida.
 * Não coloque client secrets neste arquivo. A autenticação usa um ID token do
 * Google e a API só lê/escreve a linha do e-mail autenticado.
 */
const DEFAULT_CONFIG = {
  // Preencha pelas propriedades do script, conforme o guia do projeto.
  spreadsheetId: "",
  googleClientId: ""
};

const VAULT_HEADERS = ["email", "updatedAt", "payload"];

function doGet() {
  return json_({ ok: true, service: "minha-contabilidade", message: "Backend online." });
}

function doPost(event) {
  try {
    const body = JSON.parse(event?.postData?.contents || "{}");
    const identity = verifyIdToken_(body.idToken);
    if (body.action === "get") return json_(getVault_(identity.email));
    if (body.action === "sync") return json_(saveVault_(identity.email, body.payload));
    return json_({ error: "Ação não reconhecida." }, 400);
  } catch (error) {
    return json_({ error: error.message || "Falha no backend." }, 400);
  }
}

function json_(payload, statusCode) {
  // ContentService não permite controlar todos os headers HTTP; use o Web App
  // do Apps Script e a URL /exec descrita no guia do projeto.
  return ContentService.createTextOutput(JSON.stringify({ ...payload, statusCode: statusCode || 200 }))
    .setMimeType(ContentService.MimeType.JSON);
}

function config_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: properties.getProperty("SPREADSHEET_ID") || DEFAULT_CONFIG.spreadsheetId,
    googleClientId: properties.getProperty("GOOGLE_CLIENT_ID") || DEFAULT_CONFIG.googleClientId
  };
}

function verifyIdToken_(idToken) {
  if (!idToken) throw new Error("Token de autenticação ausente.");
  const response = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error("Token de autenticação inválido.");
  const token = JSON.parse(response.getContentText());
  const config = config_();
  if (!config.googleClientId || token.aud !== config.googleClientId) throw new Error("O cliente Google não está configurado corretamente.");
  if (token.email_verified !== "true" && token.email_verified !== true) throw new Error("A conta Google precisa estar verificada.");
  return { email: String(token.email || "").trim().toLowerCase() };
}

function spreadsheet_() {
  const id = config_().spreadsheetId;
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function vaultSheet_() {
  const spreadsheet = spreadsheet_();
  let sheet = spreadsheet.getSheetByName("Vault");
  if (!sheet) sheet = spreadsheet.insertSheet("Vault");
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, VAULT_HEADERS.length).setValues([VAULT_HEADERS]);
  return sheet;
}

function getVault_(email) {
  const sheet = vaultSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, email: email, payload: null };
  const rows = sheet.getRange(2, 1, lastRow - 1, VAULT_HEADERS.length).getValues();
  const match = rows.find((row) => String(row[0]).toLowerCase() === email);
  if (!match) return { ok: true, email: email, payload: null };
  return { ok: true, email: email, updatedAt: match[1], payload: JSON.parse(match[2]) };
}

function saveVault_(email, payload) {
  if (!payload || typeof payload !== "object") throw new Error("Dados do usuário ausentes.");
  const sheet = vaultSheet_();
  const lastRow = sheet.getLastRow();
  const rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, VAULT_HEADERS.length).getValues();
  const index = rows.findIndex((row) => String(row[0]).toLowerCase() === email);
  const updatedAt = new Date().toISOString();
  const values = [[email, updatedAt, JSON.stringify(payload)]];
  if (index === -1) sheet.getRange(lastRow + 1, 1, 1, VAULT_HEADERS.length).setValues(values);
  else sheet.getRange(index + 2, 1, 1, VAULT_HEADERS.length).setValues(values);
  return { ok: true, email: email, updatedAt: updatedAt };
}
