(() => {
  "use strict";

  const CONFIG = window.FINANCE_CONFIG || {};
  const VIEWS = {
    dashboard: "Visão geral",
    lancamentos: "Lançamentos",
    contas: "Contas",
    fixos: "Custos fixos",
    cdb: "CDB",
    analises: "Análises",
    configuracoes: "Configurações"
  };
  const CATEGORIES = ["Moradia", "Casa", "Alimentação", "Transporte", "Saúde", "Educação", "Lazer", "Assinaturas", "Renda", "Investimentos", "Outros"];
  const CATEGORY_COLORS = ["#b6dcca", "#f3afb5", "#f3c885", "#b9cada", "#c9b9dc", "#a9cdd0", "#f0c3a0", "#d2d89e"];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const encoder = new TextEncoder();
  let authMode = "login";
  let session = null;
  let vault = null;
  let saveQueue = Promise.resolve();

  const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });
  const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
  const integerFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
  }

  function formatCurrency(value) {
    return currencyFormatter.format(Number(value) || 0);
  }

  function formatShortCurrency(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 1000000) return `R$ ${(number / 1000000).toFixed(1).replace(".", ",")} mi`;
    if (Math.abs(number) >= 1000) return `R$ ${(number / 1000).toFixed(1).replace(".", ",")} mil`;
    return formatCurrency(number);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? "—" : shortDateFormatter.format(date);
  }

  function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(key) {
    const date = new Date(`${key}-01T12:00:00`);
    const formatted = monthFormatter.format(date).replace(" de ", " ");
    return formatted.charAt(0).toUpperCase() + formatted.slice(1).replace(".", "");
  }

  function shiftMonth(key, amount) {
    const [year, month] = key.split("-").map(Number);
    const date = new Date(year, month - 1 + amount, 1, 12);
    return monthKey(date);
  }

  function todayIso() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function toAmount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const text = String(value || "0").trim();
    if (!text) return 0;
    const normalized = text.includes(",") && text.includes(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(",", ".");
    return Number(normalized) || 0;
  }

  function blankVault(displayName = "") {
    return {
      version: 1,
      profile: { displayName, currency: "BRL" },
      accounts: [],
      transactions: [],
      fixedCosts: [],
      cdbs: [],
      savings: [],
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeVault(value) {
    const normalized = { ...blankVault(), ...(value || {}) };
    normalized.profile = { ...blankVault().profile, ...(value?.profile || {}) };
    normalized.accounts = Array.isArray(value?.accounts) ? value.accounts : [];
    normalized.transactions = Array.isArray(value?.transactions) ? value.transactions : [];
    normalized.fixedCosts = Array.isArray(value?.fixedCosts) ? value.fixedCosts : [];
    normalized.cdbs = Array.isArray(value?.cdbs) ? value.cdbs : [];
    normalized.savings = Array.isArray(value?.savings) ? value.savings : [];
    return normalized;
  }

  async function remoteAccountId(username) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(username.trim().toLowerCase()));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function remoteRequest(action, credentials, payload, baseRevision) {
    if (!CONFIG.apiUrl) throw new Error("O endpoint online ainda não foi configurado.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(CONFIG.apiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, accountId: credentials.accountId, username: credentials.username, password: credentials.password, payload, baseRevision }), signal: controller.signal });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("O armazenamento online demorou demais para responder.");
      throw new Error("Não foi possível alcançar o armazenamento online.");
    } finally { window.clearTimeout(timeout); }
    const result = await response.json();
    if (!response.ok || result.ok === false || result.error || Number(result.statusCode) >= 400) throw new Error(result.error || "Não foi possível falar com o armazenamento online.");
    return result;
  }

  async function openRemoteAccount(username, password, displayName, signup) {
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) throw new Error("Use um usuário com 3 a 32 caracteres, sem espaços.");
    if (password.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
    const identity = { accountId: await remoteAccountId(cleanUsername), username: cleanUsername, password };
    const result = await remoteRequest(signup ? "register" : "login", identity);
    session = { mode: "online", ...identity, revision: Number(result.revision || 0) };
    vault = normalizeVault(result.payload || blankVault(result.displayName || displayName || cleanUsername));
    if (!result.payload) await saveCurrentVault();
    return { online: true, recovered: Boolean(result.recovered) };
  }

  async function saveCurrentVault() {
    if (!vault || !session) return;
    vault.updatedAt = new Date().toISOString();
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const result = await remoteRequest("sync", session, vault, session.revision || 0);
      session.revision = Number(result.revision || session.revision || 0);
      if (result.backupWarning) showToast(result.backupWarning, "error");
    }).catch((error) => { showToast(error.message, "error"); throw error; });
    return saveQueue;
  }

  function showToast(message, tone = "success") {
    const region = $("#toastRegion");
    if (!region) return;
    const toast = document.createElement("div");
    toast.className = `toast ${tone === "error" ? "toast--error" : ""}`;
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3700);
  }

  function setAuthNotice(message, success = false) {
    const notice = $("#authNotice");
    notice.textContent = message || "";
    notice.classList.toggle("is-success", success);
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === "signup";
    $("#authTitle").textContent = signup ? "Criar conta online" : "Entrar no painel";
    $("#authSubtitle").textContent = signup ? "Seu cadastro e seus dados ficam na planilha online." : "Acompanhe seu dinheiro sem planilhas espalhadas.";
    $("#authSubmit").textContent = signup ? "Criar conta" : "Entrar";
    $("#authModeToggle").textContent = signup ? "Já tenho uma conta" : "Criar uma conta online";
    $("#confirmPasswordField").classList.toggle("is-hidden", !signup);
    $("#authPassword").setAttribute("autocomplete", signup ? "new-password" : "current-password");
    setAuthNotice("");
  }

  function enterApp() {
    $("#authScreen").classList.add("is-hidden");
    $("#appShell").classList.remove("is-hidden");
    const displayName = vault.profile.displayName || session.username || "Usuário";
    $("#sidebarUserName").textContent = displayName;
    $("#sidebarAvatar").textContent = displayName.trim().charAt(0).toUpperCase() || "M";
    $("#sidebarUserMode").textContent = "planilha sincronizada";
    $("#syncBadge").innerHTML = '<span class="status-dot status-dot--green"></span>sincronizado';
    setView("dashboard");
    renderAll();
  }

  function leaveApp() {
    session = null;
    vault = null;
    $("#appShell").classList.add("is-hidden");
    $("#authScreen").classList.remove("is-hidden");
    $("#authForm").reset();
    setAuthMode("login");
  }

  function setView(viewName) {
    const view = VIEWS[viewName] ? viewName : "dashboard";
    $$("[data-view]").forEach((item) => item.classList.toggle("is-active", item.dataset.view === view));
    $$("[data-view-target]").forEach((item) => item.classList.toggle("is-active", item.dataset.viewTarget === view));
    $("#pageTitle").textContent = VIEWS[view];
    $("#sidebar").classList.remove("is-open");
    window.history.replaceState({}, "", `#${view}`);
    renderAll();
  }

  function currentPeriod() {
    return $("#periodSelect").value || monthKey();
  }

  function setupPeriodSelect() {
    const select = $("#periodSelect");
    const selected = select.value || monthKey();
    const options = Array.from({ length: 13 }, (_, index) => shiftMonth(monthKey(), -index));
    select.innerHTML = options.map((key) => `<option value="${key}">${monthLabel(key)}</option>`).join("");
    select.value = options.includes(selected) ? selected : options[0];
  }

  function populateSelect(select, options, selected = "") {
    if (!select) return;
    const current = selected || select.value;
    select.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
    if (options.some((option) => option.value === current)) select.value = current;
  }

  function refreshFormSelects() {
    const accounts = vault.accounts.map((account) => ({ value: account.id, label: account.name }));
    const linkedAccounts = vault.accounts.map((account) => ({ value: account.id, label: `${account.name} · ${account.type === "poupanca" ? "Poupança" : "Conta corrente"}` }));
    const savingsAccounts = vault.accounts.filter((account) => account.type === "poupanca").map((account) => ({ value: account.id, label: `${account.name}${account.nickname ? ` · ${account.nickname}` : ""}` }));
    populateSelect($("#transactionCategory"), CATEGORIES.map((category) => ({ value: category, label: category })), $("#transactionCategory")?.value || "Alimentação");
    populateSelect($("#transactionAccount"), accounts.length ? accounts : [{ value: "", label: "Cadastre uma conta primeiro" }], $("#transactionAccount")?.value || "");
    populateSelect($("#fixedAccount"), [{ value: "", label: "Sem conta definida" }, ...accounts], $("#fixedAccount")?.value || "");
    populateSelect($("#cdbAccount"), linkedAccounts.length ? linkedAccounts : [{ value: "", label: "Cadastre uma conta primeiro" }], $("#cdbAccount")?.value || "");
    populateSelect($("#savingsAccount"), savingsAccounts.length ? savingsAccounts : [{ value: "", label: "Cadastre uma conta do tipo poupança" }], $("#savingsAccount")?.value || "");
  }

  function transactionsForPeriod(period = currentPeriod()) {
    return vault.transactions.filter((item) => String(item.date || "").startsWith(period));
  }

  function sumTransactions(items, type) {
    return items.filter((item) => item.type === type).reduce((sum, item) => sum + toAmount(item.amount), 0);
  }

  function accountBalance(accountId) {
    const account = vault.accounts.find((item) => item.id === accountId);
    if (!account) return 0;
    return toAmount(account.balance) + vault.transactions.filter((item) => item.accountId === accountId).reduce((sum, item) => sum + (item.type === "entrada" ? toAmount(item.amount) : -toAmount(item.amount)), 0);
  }

  function totalBalance() {
    return vault.accounts.reduce((sum, account) => sum + accountBalance(account.id), 0);
  }

  function accountById(accountId) {
    return vault.accounts.find((account) => account.id === accountId);
  }

  function savingsConfig(accountId) {
    return vault.savings.find((item) => item.accountId === accountId);
  }

  function elapsedMonths(referenceDate) {
    const reference = new Date(`${referenceDate}T12:00:00`);
    const now = new Date();
    if (Number.isNaN(reference.getTime())) return 0;
    let months = (now.getFullYear() - reference.getFullYear()) * 12 + now.getMonth() - reference.getMonth();
    if (now.getDate() < reference.getDate()) months -= 1;
    return Math.max(0, months);
  }

  function savingsSummary(account) {
    const config = savingsConfig(account.id);
    const baseBalance = accountBalance(account.id);
    const monthlyRate = toAmount(config?.monthlyRate ?? 0.5);
    const referenceDate = config?.referenceDate || account.createdAt || todayIso();
    const automaticYield = baseBalance * (Math.pow(1 + monthlyRate / 100, elapsedMonths(referenceDate)) - 1);
    const hasManualCorrection = config?.manualYield !== null && config?.manualYield !== undefined && String(config.manualYield).trim() !== "";
    const yieldValue = hasManualCorrection ? toAmount(config.manualYield) : automaticYield;
    return { config, baseBalance, monthlyRate, referenceDate, automaticYield, yieldValue, hasManualCorrection, projectedBalance: baseBalance + yieldValue };
  }

  function metricCard(label, value, meta, className = "") {
    return `<article class="metric-card ${className}"><p class="metric-label">${escapeHtml(label)}</p><div class="metric-value">${escapeHtml(value)}</div><p class="metric-meta">${escapeHtml(meta)}</p></article>`;
  }

  function renderDashboard() {
    const period = currentPeriod();
    const periodTransactions = transactionsForPeriod(period);
    const income = sumTransactions(periodTransactions, "entrada");
    const expense = sumTransactions(periodTransactions, "saida");
    const result = income - expense;
    const savingsRate = income ? Math.round((result / income) * 100) : 0;
    const fixedTotal = vault.fixedCosts.filter((item) => item.active !== false).reduce((sum, item) => sum + toAmount(item.amount), 0);
    const cdbTotal = vault.cdbs.reduce((sum, item) => sum + toAmount(item.principal), 0);
    const displayName = vault.profile.displayName || "você";
    $("#dashboardGreeting").textContent = `Olá, ${displayName.split(" ")[0]}.`;
    $("#dashboardLead").textContent = `Este é o retrato do seu dinheiro em ${monthLabel(period)}.`;
    $("#cashflowPeriod").textContent = monthLabel(period);
    $("#dashboardMetrics").innerHTML = [
      metricCard("SALDO CONSOLIDADO", formatShortCurrency(totalBalance()), "saldo calculado das contas", "metric-card--accent"),
      metricCard("ENTRADAS", formatShortCurrency(income), "no período selecionado", "metric-card--positive"),
      metricCard("SAÍDAS", formatShortCurrency(expense), "no período selecionado", ""),
      metricCard("RESULTADO", formatShortCurrency(result), income ? `${savingsRate}% de sobra no mês` : "adicione uma entrada para calcular", result >= 0 ? "metric-card--positive" : "metric-card--warning")
    ].join("");
    renderCashflow();
    renderCategories(periodTransactions);
    renderUpcomingFixedCosts();
    renderAccountSnapshot(cdbTotal);
  }

  function renderCashflow() {
    const months = Array.from({ length: 6 }, (_, index) => shiftMonth(currentPeriod(), index - 5));
    const values = months.map((period) => {
      const items = transactionsForPeriod(period);
      return { period, income: sumTransactions(items, "entrada"), expense: sumTransactions(items, "saida") };
    });
    const max = Math.max(...values.flatMap((item) => [item.income, item.expense]), 1);
    $("#cashflowChart").innerHTML = values.map((item) => `<div class="cash-bar-group"><div class="cash-bar cash-bar--income" style="height:${Math.max(3, (item.income / max) * 100)}%" title="Entradas ${formatCurrency(item.income)}"></div><div class="cash-bar cash-bar--expense" style="height:${Math.max(3, (item.expense / max) * 100)}%" title="Saídas ${formatCurrency(item.expense)}"></div><span class="cash-month">${monthLabel(item.period).slice(0, 3)}</span></div>`).join("");
  }

  function renderCategories(items) {
    const grouped = items.filter((item) => item.type === "saida").reduce((map, item) => { map[item.category] = (map[item.category] || 0) + toAmount(item.amount); return map; }, {});
    const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    const stops = entries.length ? entries.map(([, value], index) => `${CATEGORY_COLORS[index % CATEGORY_COLORS.length]} ${index === 0 ? 0 : entries.slice(0, index).reduce((sum, [, amount]) => sum + amount, 0) / total * 100}% ${entries.slice(0, index + 1).reduce((sum, [, amount]) => sum + amount, 0) / total * 100}%`).join(", ") : "#e4eaed 0 100%";
    $("#categoryChart").style.background = `conic-gradient(${stops})`;
    $("#categoryLegend").innerHTML = entries.length ? entries.slice(0, 5).map(([category, amount], index) => `<div class="category-legend-row"><span><i class="category-color" style="background:${CATEGORY_COLORS[index % CATEGORY_COLORS.length]}"></i>${escapeHtml(category)}</span><strong>${total ? Math.round(amount / total * 100) : 0}%</strong></div>`).join("") : `<div class="empty-state"><strong>Nada por aqui ainda.</strong><span>Seus gastos aparecerão por categoria.</span></div>`;
  }

  function renderUpcomingFixedCosts() {
    const items = vault.fixedCosts.filter((item) => item.active !== false).sort((a, b) => Number(a.dueDay) - Number(b.dueDay)).slice(0, 4);
    $("#upcomingFixedCosts").innerHTML = items.length ? items.map((item) => `<div class="list-row"><div class="list-row-main"><span class="due-badge">${escapeHtml(item.dueDay)}<span>º</span></span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category || "Custo fixo")}</small></div></div><strong class="row-value">${formatCurrency(item.amount)}</strong></div>`).join("") : `<div class="empty-state"><strong>Seu mês ainda está aberto.</strong><span>Cadastre o primeiro custo fixo.</span><button class="link-button" data-view-link="fixos">Cadastrar agora →</button></div>`;
  }

  function renderAccountSnapshot(cdbTotal = 0) {
    const accounts = vault.accounts.slice().sort((a, b) => accountBalance(b.id) - accountBalance(a.id)).slice(0, 4);
    const markup = accounts.length ? accounts.map((account) => `<div class="account-row"><div class="account-row-main"><span class="account-mark">${escapeHtml(account.name.slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(account.name)}</strong><small>${account.type === "poupanca" ? "Poupança" : "Conta corrente"}</small></div></div><strong class="row-value">${formatCurrency(accountBalance(account.id))}</strong></div>`).join("") : `<div class="empty-state"><strong>Cadastre seus bancos.</strong><span>Assim o saldo consolidado fará sentido.</span><button class="link-button" data-view-link="contas">Adicionar conta →</button></div>`;
    $("#accountSnapshot").innerHTML = markup + (accounts.length && cdbTotal ? `<div class="account-row"><div class="account-row-main"><span class="account-mark">C</span><div><strong>CDB</strong><small>Investimentos separados</small></div></div><strong class="row-value">${formatCurrency(cdbTotal)}</strong></div>` : "");
  }

  function renderTransactions() {
    const period = currentPeriod();
    const filter = $("#transactionFilter").value;
    const items = transactionsForPeriod(period).filter((item) => filter === "todos" || item.type === filter).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const accountNames = Object.fromEntries(vault.accounts.map((account) => [account.id, account.name]));
    $("#transactionTable").innerHTML = items.length ? `<table class="data-table"><thead><tr><th>DATA</th><th>DESCRIÇÃO</th><th>CATEGORIA</th><th>CONTA</th><th>VALOR</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td>${formatDate(item.date)}</td><td><strong>${escapeHtml(item.description)}</strong>${item.notes ? `<br><small class="muted-cell">${escapeHtml(item.notes)}</small>` : ""}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(accountNames[item.accountId] || "—")}</td><td class="number ${item.type === "entrada" ? "positive-number" : "negative-number"}">${item.type === "entrada" ? "+" : "−"}${formatCurrency(item.amount)}</td><td><span class="table-actions"><button class="table-action" type="button" data-action="edit-transaction" data-id="${item.id}" title="Editar">✎</button><button class="table-action" type="button" data-action="delete-transaction" data-id="${item.id}" title="Excluir">×</button></span></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum lançamento em ${monthLabel(period)}.</strong><span>Comece registrando uma entrada ou saída.</span><button class="button button--secondary" type="button" data-action="open-transaction">Adicionar lançamento</button></div>`;
  }

  function renderAccounts() {
    const balance = totalBalance();
    const current = transactionsForPeriod().filter((item) => item.type === "entrada").reduce((sum, item) => sum + toAmount(item.amount), 0);
    const cdb = vault.cdbs.reduce((sum, item) => sum + toAmount(item.principal), 0);
    $("#accountMetrics").innerHTML = [metricCard("SALDO EM CONTAS", formatShortCurrency(balance), "saldo calculado", "metric-card--accent"), metricCard("ENTRADAS DO MÊS", formatShortCurrency(current), "movimentos positivos", "metric-card--positive"), metricCard("SEPARADO EM CDB", formatShortCurrency(cdb), `${vault.cdbs.length} posição(ões)`, "")].join("");
    $("#accountList").innerHTML = vault.accounts.length ? vault.accounts.map((account) => `<div class="account-row"><div class="account-row-main"><span class="account-mark">${escapeHtml(account.name.slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(account.name)}</strong><small>${account.type === "poupanca" ? "Poupança" : "Conta corrente"}${account.nickname ? ` · ${escapeHtml(account.nickname)}` : ""}</small></div></div><strong class="row-value">${formatCurrency(accountBalance(account.id))}</strong><span class="table-actions"><button class="table-action" type="button" data-action="delete-account" data-id="${account.id}" title="Excluir conta">×</button></span></div>`).join("") : `<div class="empty-state"><strong>Nenhuma conta cadastrada.</strong><span>Cadastre seu primeiro banco para acompanhar os saldos.</span></div>`;
    renderSavingsManagement();
  }

  function fillSavingsForm() {
    const form = $("#savingsForm");
    const select = $("#savingsAccount");
    if (!form || !select) return;
    const account = accountById(select.value) || vault.accounts.find((item) => item.type === "poupanca");
    const fields = {
      monthlyRate: $("input[name='monthlyRate']", form),
      referenceDate: $("input[name='referenceDate']", form),
      manualYield: $("input[name='manualYield']", form),
      correctionNote: $("input[name='correctionNote']", form)
    };
    if (!account) {
      Object.values(fields).forEach((field) => { if (field) field.value = ""; });
      return;
    }
    select.value = account.id;
    const summary = savingsSummary(account);
    fields.monthlyRate.value = summary.config ? summary.monthlyRate : "0.50";
    fields.referenceDate.value = summary.referenceDate;
    fields.manualYield.value = summary.hasManualCorrection ? summary.config.manualYield : "";
    fields.correctionNote.value = summary.config?.correctionNote || "";
  }

  function renderSavingsManagement() {
    const savingsAccounts = vault.accounts.filter((account) => account.type === "poupanca");
    $("#savingsSummary").innerHTML = savingsAccounts.length ? savingsAccounts.map((account) => {
      const summary = savingsSummary(account);
      const mode = summary.hasManualCorrection ? "correção manual" : `${summary.monthlyRate.toFixed(2).replace(".", ",")}% a.m. estimativa`;
      return `<div class="savings-row"><div class="account-row-main"><span class="account-mark">${escapeHtml(account.name.slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(account.name)}</strong><small>${mode} · base em ${formatDate(summary.referenceDate)}</small></div></div><div class="savings-row-values"><span><small>Rendimento</small><strong>${formatCurrency(summary.yieldValue)}</strong></span><span><small>Saldo projetado</small><strong>${formatCurrency(summary.projectedBalance)}</strong></span></div></div>`;
    }).join("") : `<div class="empty-state"><strong>Nenhuma poupança cadastrada.</strong><span>Cadastre uma conta com o tipo Poupança para começar a acompanhar o rendimento.</span></div>`;
    fillSavingsForm();
  }

  function renderFixedCosts() {
    const active = vault.fixedCosts.filter((item) => item.active !== false);
    const total = active.reduce((sum, item) => sum + toAmount(item.amount), 0);
    const average = active.length ? total / active.length : 0;
    const next = active.slice().sort((a, b) => Number(a.dueDay) - Number(b.dueDay))[0]?.dueDay;
    $("#fixedMetrics").innerHTML = [metricCard("CUSTO MENSAL", formatShortCurrency(total), "compromissos ativos", "metric-card--accent"), metricCard("ITENS ATIVOS", integerFormatter.format(active.length), "despesas recorrentes", ""), metricCard("MÉDIA POR ITEM", formatShortCurrency(average), next ? `próximo vencimento: dia ${next}` : "cadastre um compromisso", "metric-card--warning")].join("");
    const accountNames = Object.fromEntries(vault.accounts.map((account) => [account.id, account.name]));
    const items = vault.fixedCosts.slice().sort((a, b) => Number(a.dueDay) - Number(b.dueDay));
    $("#fixedCostTable").innerHTML = items.length ? `<table class="data-table"><thead><tr><th>VENC.</th><th>DESCRIÇÃO</th><th>CATEGORIA</th><th>CONTA</th><th>VALOR</th><th>STATUS</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td>Dia ${escapeHtml(item.dueDay)}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(accountNames[item.accountId] || "—")}</td><td class="number">${formatCurrency(item.amount)}</td><td><span class="status-pill ${item.active !== false ? "status-pill--green" : "status-pill--muted"}">${item.active !== false ? "ATIVO" : "PAUSADO"}</span></td><td><span class="table-actions"><button class="table-action" type="button" data-action="toggle-fixed" data-id="${item.id}" title="Ativar ou pausar">↻</button><button class="table-action" type="button" data-action="delete-fixed" data-id="${item.id}" title="Excluir">×</button></span></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum custo fixo cadastrado.</strong><span>Registre aluguel, assinaturas, contas e outros compromissos mensais.</span></div>`;
  }

  function renderCdb() {
    const positions = vault.cdbs;
    const principal = positions.reduce((sum, item) => sum + toAmount(item.principal), 0);
    const prefixPositions = positions.filter((item) => item.rateType === "pre");
    const monthlyProjection = prefixPositions.reduce((sum, item) => sum + (toAmount(item.principal) * (toAmount(item.rate) / 100) / 12), 0);
    const nextMaturity = positions.filter((item) => item.maturityAt).sort((a, b) => String(a.maturityAt).localeCompare(String(b.maturityAt)))[0]?.maturityAt;
    $("#cdbMetrics").innerHTML = [metricCard("TOTAL APLICADO", formatShortCurrency(principal), `${positions.length} posição(ões)`, "metric-card--accent"), metricCard("PROJEÇÃO MENSAL", prefixPositions.length ? formatShortCurrency(monthlyProjection) : "—", prefixPositions.length ? "estimativa bruta prefixada" : "informe uma taxa prefixada", "metric-card--positive"), metricCard("PRÓXIMO VENCIMENTO", nextMaturity ? formatDate(nextMaturity) : "—", nextMaturity ? "conforme cadastro" : "nenhum vencimento informado", "")].join("");
    $("#cdbTable").innerHTML = positions.length ? `<table class="data-table"><thead><tr><th>POSIÇÃO</th><th>CONTA / BANCO</th><th>APLICADO</th><th>TAXA</th><th>LIQUIDEZ</th><th>VENCIMENTO</th><th></th></tr></thead><tbody>${positions.map((item) => { const account = accountById(item.accountId); const institution = account ? `${account.name}${account.nickname ? ` · ${account.nickname}` : ""}` : item.bank || "—"; return `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(institution)}</td><td class="number">${formatCurrency(item.principal)}</td><td>${escapeHtml(item.rate)}${item.rateType === "CDI" ? "% CDI" : "% a.a."}</td><td>${escapeHtml(item.liquidity)}</td><td>${formatDate(item.maturityAt)}</td><td><span class="table-actions"><button class="table-action" type="button" data-action="delete-cdb" data-id="${item.id}" title="Excluir">×</button></span></td></tr>`; }).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum CDB cadastrado.</strong><span>Separe suas aplicações do saldo das contas e acompanhe o vencimento.</span></div>`;
  }

  function getMonthlySummary(count = 6) {
    return Array.from({ length: count }, (_, index) => {
      const period = shiftMonth(currentPeriod(), index - (count - 1));
      const items = transactionsForPeriod(period);
      const income = sumTransactions(items, "entrada");
      const expense = sumTransactions(items, "saida");
      return { period, income, expense, result: income - expense, rate: income ? (income - expense) / income * 100 : 0 };
    });
  }

  function renderAnalyses() {
    const months = getMonthlySummary();
    const periodItems = transactionsForPeriod();
    const expenseItems = periodItems.filter((item) => item.type === "saida");
    const grouped = expenseItems.reduce((map, item) => { map[item.category] = (map[item.category] || 0) + toAmount(item.amount); return map; }, {});
    const topCategory = Object.entries(grouped).sort((a, b) => b[1] - a[1])[0];
    const selectedMonth = months[months.length - 1];
    const savings = selectedMonth.income ? Math.round(selectedMonth.rate) : 0;
    const cdb = vault.cdbs.reduce((sum, item) => sum + toAmount(item.principal), 0);
    $("#analysisHighlights").innerHTML = [
      `<article class="insight-card"><p class="eyebrow">TAXA DE SOBRA</p><h3>${savings}%</h3><p>do que entrou em ${monthLabel(selectedMonth.period)} ficou no caixa.</p></article>`,
      `<article class="insight-card"><p class="eyebrow">MAIOR CATEGORIA</p><h3>${topCategory ? escapeHtml(topCategory[0]) : "—"}</h3><p>${topCategory ? `${formatCurrency(topCategory[1])} em saídas no período.` : "Cadastre saídas para descobrir."}</p></article>`,
      `<article class="insight-card"><p class="eyebrow">PARTICIPAÇÃO EM CDB</p><h3>${cdb + totalBalance() ? Math.round(cdb / (cdb + totalBalance()) * 100) : 0}%</h3><p>do patrimônio conhecido está separado em investimento.</p></article>`
    ].join("");
    const max = Math.max(...months.flatMap((item) => [Math.abs(item.income), Math.abs(item.expense)]), 1);
    $("#analysisBars").innerHTML = months.map((item) => `<div class="analysis-bar-group"><div class="analysis-bar analysis-bar--positive" style="height:${Math.max(3, item.income / max * 100)}%" title="Entradas ${formatCurrency(item.income)}"></div><div class="analysis-bar analysis-bar--negative" style="height:${Math.max(3, item.expense / max * 100)}%" title="Saídas ${formatCurrency(item.expense)}"></div><span class="analysis-bar-label">${monthLabel(item.period).slice(0, 3)}</span></div>`).join("");
    const totalExpense = expenseItems.reduce((sum, item) => sum + toAmount(item.amount), 0);
    const categories = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    $("#analysisCategories").innerHTML = categories.length ? categories.map(([category, amount]) => `<div class="analysis-category"><span>${escapeHtml(category)}</span><div class="analysis-track"><span style="width:${totalExpense ? amount / totalExpense * 100 : 0}%"></span></div><strong>${formatShortCurrency(amount)}</strong></div>`).join("") : `<div class="empty-state"><strong>Sem categorias ainda.</strong><span>Os pesos aparecerão com seus lançamentos.</span></div>`;
    $("#analysisTable").innerHTML = `<table class="data-table"><thead><tr><th>MÊS</th><th>ENTRADAS</th><th>SAÍDAS</th><th>RESULTADO</th><th>TAXA DE SOBRA</th></tr></thead><tbody>${months.map((item) => `<tr><td><strong>${monthLabel(item.period)}</strong></td><td class="number positive-number">${formatCurrency(item.income)}</td><td class="number negative-number">${formatCurrency(item.expense)}</td><td class="number ${item.result >= 0 ? "positive-number" : "negative-number"}">${formatCurrency(item.result)}</td><td class="number">${item.income ? `${Math.round(item.rate)}%` : "—"}</td></tr>`).join("")}</tbody></table>`;
  }

  function renderSettings() {
    $("#profileDisplayName").value = vault.profile.displayName || "";
    $("#storageTitle").textContent = "Planilha sincronizada";
    $("#storagePill").textContent = "ONLINE";
    $("#storageDescription").textContent = "Os lançamentos são gravados na planilha e recebem snapshots automáticos na pasta do Drive.";
    $("#storageDetail").textContent = "A planilha online é a fonte oficial dos seus dados.";
  }

  function renderAll() {
    if (!vault) return;
    setupPeriodSelect();
    refreshFormSelects();
    renderDashboard();
    renderTransactions();
    renderAccounts();
    renderFixedCosts();
    renderCdb();
    renderAnalyses();
    renderSettings();
  }

  function clearForm(form) {
    form.reset();
    form.removeAttribute("data-edit-id");
    if (form.id === "transactionForm") {
      $("input[name='date']", form).value = todayIso();
      $("input[name='transactionType'][value='saida']", form).checked = true;
      $("#transactionCategory").value = "Alimentação";
    }
    if (form.id === "cdbForm") $("input[name='startedAt']", form).value = todayIso();
  }

  function fillDefaultForms() {
    clearForm($("#transactionForm"));
    clearForm($("#cdbForm"));
  }

  async function deleteById(collection, id, message) {
    if (!window.confirm(message)) return;
    vault[collection] = vault[collection].filter((item) => item.id !== id);
    await saveCurrentVault();
    renderAll();
    showToast("Registro removido.");
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setAuthNotice("Verificando…");
    try {
      if (authMode === "signup") {
        if (data.password !== data.passwordConfirm) throw new Error("As senhas não conferem.");
        const opened = await openRemoteAccount(data.username, data.password, data.username, true);
        setAuthNotice("Conta criada.", true);
        enterApp();
        showToast("Conta criada e sincronizada na planilha.");
      } else {
        const opened = await openRemoteAccount(data.username, data.password, data.username, false);
        enterApp();
        if (opened.recovered) showToast("Dados recuperados do histórico da planilha.");
      }
    } catch (error) {
      setAuthNotice(error.message || "Não foi possível concluir.");
    }
  }

  async function handleTransactionSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.accountId) { showToast("Cadastre uma conta antes de lançar um movimento.", "error"); setView("contas"); return; }
    const transaction = { id: form.dataset.editId || uid("tx"), date: data.date, description: data.description.trim(), category: data.category, accountId: data.accountId, amount: toAmount(data.amount), type: data.transactionType, notes: data.notes?.trim() || "", recurring: data.recurring === "on" };
    const existingIndex = vault.transactions.findIndex((item) => item.id === form.dataset.editId);
    if (existingIndex >= 0) vault.transactions[existingIndex] = { ...vault.transactions[existingIndex], ...transaction };
    else vault.transactions.push(transaction);
    await saveCurrentVault();
    clearForm(form);
    renderAll();
    showToast(existingIndex >= 0 ? "Lançamento atualizado." : "Lançamento salvo.");
  }

  function editTransaction(id) {
    const item = vault.transactions.find((transaction) => transaction.id === id);
    if (!item) return;
    setView("lancamentos");
    const form = $("#transactionForm");
    form.dataset.editId = item.id;
    $("input[name='date']", form).value = item.date || todayIso();
    $("input[name='amount']", form).value = item.amount;
    $("input[name='description']", form).value = item.description;
    $("#transactionCategory").value = item.category;
    $("#transactionAccount").value = item.accountId;
    $("input[name='notes']", form).value = item.notes || "";
    $("input[name='recurring']", form).checked = Boolean(item.recurring);
    $("input[name='transactionType'][value='entrada']", form).checked = item.type === "entrada";
    $("input[name='transactionType'][value='saida']", form).checked = item.type !== "entrada";
    $("#transactionFormPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Edite os campos e salve novamente.");
  }

  async function handleAccountSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    vault.accounts.push({ id: uid("account"), name: data.name.trim(), type: data.type, balance: toAmount(data.balance), nickname: data.nickname?.trim() || "", createdAt: todayIso() });
    await saveCurrentVault();
    clearForm(form);
    renderAll();
    showToast("Conta adicionada.");
  }

  async function handleFixedSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    vault.fixedCosts.push({ id: uid("fixed"), name: data.name.trim(), category: data.category, amount: toAmount(data.amount), dueDay: Number(data.dueDay), accountId: data.accountId || "", active: data.active === "on" });
    await saveCurrentVault();
    clearForm(form);
    renderAll();
    showToast("Custo fixo salvo.");
  }

  async function handleCdbSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const account = accountById(data.accountId);
    if (!account) { showToast("Cadastre e selecione a conta que guarda este CDB.", "error"); setView("contas"); return; }
    vault.cdbs.push({ id: uid("cdb"), name: data.name.trim(), accountId: account.id, bank: account.name, principal: toAmount(data.principal), rate: toAmount(data.rate), rateType: data.rateType, startedAt: data.startedAt, maturityAt: data.maturityAt || "", liquidity: data.liquidity });
    await saveCurrentVault();
    clearForm(form);
    renderAll();
    showToast("CDB cadastrado.");
  }

  async function handleSavingsSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const account = accountById(data.accountId);
    if (!account || account.type !== "poupanca") { showToast("Selecione uma conta do tipo poupança.", "error"); return; }
    const existing = savingsConfig(account.id);
    const rawManualYield = String(data.manualYield || "").trim();
    const rawMonthlyRate = String(data.monthlyRate || "").trim();
    const monthlyRate = rawMonthlyRate ? toAmount(rawMonthlyRate) : 0.5;
    if (monthlyRate < 0 || (rawManualYield && toAmount(rawManualYield) < 0)) { showToast("Taxa e rendimento corrigido não podem ser negativos.", "error"); return; }
    const record = { id: existing?.id || uid("savings"), accountId: account.id, monthlyRate, referenceDate: data.referenceDate || todayIso(), manualYield: rawManualYield ? toAmount(rawManualYield) : null, correctionNote: data.correctionNote?.trim() || "", updatedAt: new Date().toISOString() };
    const index = vault.savings.findIndex((item) => item.accountId === account.id);
    if (index >= 0) vault.savings[index] = record;
    else vault.savings.push(record);
    await saveCurrentVault();
    renderAll();
    showToast(rawManualYield ? "Correção da poupança salva." : "Rendimento estimado da poupança atualizado.");
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    vault.profile.displayName = data.displayName.trim();
    await saveCurrentVault();
    enterApp();
    showToast("Perfil atualizado.");
  }

  async function clearAllData() {
    if (!window.confirm("Apagar todos os lançamentos, contas, custos fixos, CDBs e configurações de poupança deste usuário? Essa ação não pode ser desfeita.")) return;
    vault = blankVault(vault.profile.displayName);
    await saveCurrentVault();
    renderAll();
    showToast("Dados deste usuário apagados.");
  }

  async function deleteAccount(accountId) {
    const account = accountById(accountId);
    if (!account) return;
    const references = [
      vault.transactions.some((item) => item.accountId === accountId),
      vault.fixedCosts.some((item) => item.accountId === accountId),
      vault.cdbs.some((item) => item.accountId === accountId),
      vault.savings.some((item) => item.accountId === accountId)
    ];
    if (references.some(Boolean)) { showToast("Não exclua uma conta que ainda está vinculada a lançamentos, custos, CDB ou poupança.", "error"); return; }
    await deleteById("accounts", accountId, `Excluir a conta ${account.name}?`);
  }

  function bindEvents() {
    $("#authForm").addEventListener("submit", handleAuthSubmit);
    $("#authModeToggle").addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
    $("#logoutButton").addEventListener("click", leaveApp);
    $("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("is-open"));
    $("#periodSelect").addEventListener("change", renderAll);
    $("#transactionFilter").addEventListener("change", renderTransactions);
    $("#transactionForm").addEventListener("submit", handleTransactionSubmit);
    $("#accountForm").addEventListener("submit", handleAccountSubmit);
    $("#fixedCostForm").addEventListener("submit", handleFixedSubmit);
    $("#cdbForm").addEventListener("submit", handleCdbSubmit);
    $("#savingsForm").addEventListener("submit", handleSavingsSubmit);
    $("#savingsAccount").addEventListener("change", fillSavingsForm);
    $("#profileForm").addEventListener("submit", handleProfileSubmit);
    document.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-view-target], [data-view-link], [data-action]");
      if (!target) return;
      if (target.dataset.viewTarget || target.dataset.viewLink) { setView(target.dataset.viewTarget || target.dataset.viewLink); return; }
      const action = target.dataset.action;
      if (action === "open-transaction") { setView("lancamentos"); window.setTimeout(() => $("#transactionFormPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); }
      if (action === "clear-all") await clearAllData();
      if (action === "delete-transaction") await deleteById("transactions", target.dataset.id, "Excluir este lançamento?");
      if (action === "edit-transaction") editTransaction(target.dataset.id);
      if (action === "delete-account") await deleteAccount(target.dataset.id);
      if (action === "delete-fixed") await deleteById("fixedCosts", target.dataset.id, "Excluir este custo fixo?");
      if (action === "delete-cdb") await deleteById("cdbs", target.dataset.id, "Excluir esta posição de CDB?");
      if (action === "toggle-fixed") { const item = vault.fixedCosts.find((fixed) => fixed.id === target.dataset.id); if (item) { item.active = item.active === false; await saveCurrentVault(); renderAll(); showToast(item.active ? "Custo fixo ativado." : "Custo fixo pausado."); } }
    });
  }

  function start() {
    if (!window.crypto?.subtle) { setAuthNotice("Este navegador não oferece a conexão segura necessária."); return; }
    if (!CONFIG.apiUrl) { setAuthNotice("O armazenamento online ainda não foi configurado."); return; }
    bindEvents();
    setupPeriodSelect();
    fillDefaultForms();
    const hashView = window.location.hash.replace("#", "");
    if (VIEWS[hashView]) setView(hashView);
  }

  start();
})();
