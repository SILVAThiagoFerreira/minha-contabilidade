import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = await fs.readFile(path.join(root, "app.js"), "utf8");
const html = await fs.readFile(path.join(root, "index.html"), "utf8");
const backend = await fs.readFile(path.join(root, "backend", "Code.gs"), "utf8");

assert.match(app, /cards:\s*\[\],\s*cardPayments:\s*\[\]/, "o cofre novo precisa ser aditivo");
assert.match(app, /normalizeCardDueDay/, "o cartão precisa ter vencimento mensal normalizado");
assert.match(app, /active !== false/, "cartões excluídos precisam ser arquivados, não apagados");
assert.match(app, /function validateCardsPayload[\s\S]*?cardPaymentId/, "o frontend precisa validar o vínculo da fatura");
assert.match(app, /const payment = \{ id: paymentId, cardId: card\.id, accountId: account\.id, date, amount, transactionId/, "a fatura precisa guardar cartão, conta, data, valor e lançamento");
assert.match(app, /const transaction = \{ id: transactionId,[\s\S]*?type: "saida"[\s\S]*?cardPaymentId: paymentId \}/, "a fatura precisa gerar uma saída vinculada");
assert.match(backend, /function validateCards_[\s\S]*?A fatura paga precisa sair da conta atrelada ao cartão/, "o backend precisa rejeitar conta divergente");
assert.match(backend, /validateCards_\(payload\.cards \|\| \[\], payload\.cardPayments \|\| \[\], payload\.transactions \|\| \[\], payload\.accounts \|\| \[\]\)/, "a persistência precisa chamar o validador de cartões");
for (const marker of ["data-view-target=\"cartoes\"", "id=\"cardForm\"", "id=\"cardPaymentForm\"", "id=\"cardAccount\"", "name=\"dueDay\"", "id=\"cardPaymentCard\"", "id=\"cardPaymentTable\""]) assert.match(html, new RegExp(marker), `interface ausente: ${marker}`);
console.log("cards-contract: contrato frontend/backend da coleção cards e cardPayments OK");
