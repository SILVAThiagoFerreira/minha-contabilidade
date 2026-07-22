(() => {
  "use strict";

  const CONFIG = window.FINANCE_CONFIG || {};
  const VIEWS = {
    dashboard: "Visão geral",
    lancamentos: "Lançamentos",
    contas: "Contas",
    dividas: "Dívidas",
    fixos: "Custos fixos",
    cdb: "Investimentos",
    investimentos: "Investimentos",
    patrimonio: "Patrimônio",
    analises: "Análises",
    configuracoes: "Configurações"
  };
  const UNAVAILABLE_CATEGORY = "Categoria não disponível no sistema";
  const CATEGORIES = [
    "Moradia",
    "Casa",
    "Alimentação",
    "Transporte",
    "Saúde",
    "Educação",
    "Lazer",
    "Assinaturas",
    "Compras online",
    "Vestuário",
    "Cuidados pessoais",
    "Pets",
    "Viagens",
    "Impostos e taxas",
    "Serviços",
    "Doações",
    "Renda",
    "Investimentos",
    UNAVAILABLE_CATEGORY
  ];
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
  const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const moneyInputFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    return formatCurrency(value);
  }

  function formatMoneyInput(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (!digits) return "";
    return moneyInputFormatter.format(Number(digits) / 100);
  }

  function setMoneyInputValue(input, value) {
    if (!input) return;
    const amount = toAmount(value);
    input.value = amount ? moneyInputFormatter.format(amount) : "";
  }

  function maskMoneyInput(event) {
    const input = event.currentTarget;
    input.value = formatMoneyInput(input.value);
  }

  function setupMoneyInputs() {
    const selectors = [
      "#transactionForm [name='amount']",
      "#accountForm [name='balance']",
      "#transferForm [name='amount']",
      "#savingsForm [name='manualYield']",
      "#debtForm [name='balance']",
      "#debtForm [name='installment']",
      "#fixedCostForm [name='amount']",
      "#cdbForm [name='principal']",
      "#investmentOperationAmount",
      "#patrimonyForm [name='currentValue']"
    ];
    $$(selectors.join(",")).forEach((input) => {
      input.type = "text";
      input.inputMode = "decimal";
      input.autocomplete = "off";
      input.dataset.moneyInput = "true";
      input.addEventListener("input", maskMoneyInput);
    });
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
      debts: [],
      transactions: [],
      transfers: [],
      fixedCosts: [],
      fixedCostPayments: [],
      cdbs: [],
      investments: [],
      patrimony: [],
      savings: [],
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeLaunchCategory(category) {
    const value = String(category || "").trim();
    return !value || value.toLowerCase() === "outros" ? UNAVAILABLE_CATEGORY : value;
  }

  function normalizeVault(value) {
    const normalized = { ...blankVault(), ...(value || {}) };
    normalized.profile = { ...blankVault().profile, ...(value?.profile || {}) };
    normalized.accounts = Array.isArray(value?.accounts) ? value.accounts : [];
    normalized.debts = Array.isArray(value?.debts) ? value.debts : [];
    normalized.transactions = Array.isArray(value?.transactions)
      ? value.transactions.map((item) => ({ ...item, category: normalizeLaunchCategory(item?.category) }))
      : [];
    normalized.transfers = Array.isArray(value?.transfers) ? value.transfers : [];
    normalized.fixedCosts = Array.isArray(value?.fixedCosts)
      ? value.fixedCosts.map((item) => ({ ...item, category: normalizeLaunchCategory(item?.category) }))
      : [];
    normalized.fixedCostPayments = Array.isArray(value?.fixedCostPayments)
      ? value.fixedCostPayments.map((item) => ({
        ...item,
        period: item?.period || item?.month || ""
      }))
      : [];
    const legacyCdbs = Array.isArray(value?.cdbs) ? value.cdbs : [];
    const storedInvestments = Array.isArray(value?.investments) ? value.investments : [];
    const investmentById = new Map();
    const addInvestment = (item, fallbackType = "outro") => {
      const normalizedItem = { ...item, id: item?.id || uid("investment"), type: item?.type || fallbackType };
      if (!investmentById.has(normalizedItem.id)) investmentById.set(normalizedItem.id, normalizedItem);
    };
    storedInvestments.forEach((item) => addInvestment(item));
    legacyCdbs.forEach((item) => addInvestment(item, "cdb"));
    normalized.investments = [...investmentById.values()];
    normalized.cdbs = legacyCdbs;
    normalized.patrimony = Array.isArray(value?.patrimony) ? value.patrimony : [];
    normalized.savings = Array.isArray(value?.savings) ? value.savings : [];
    return normalized;
  }

  function syncLegacyCdbs() {
    if (!vault) return;
    vault.cdbs = vault.investments.filter((item) => (item.type || "cdb") === "cdb").map((item) => ({
      ...item,
      rateType: item.rateType === "cdi" ? "CDI" : item.rateType
    }));
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

  async function changeRemotePassword(currentPassword, newPassword) {
    if (!session) throw new Error("Sua sessão expirou. Entre novamente para trocar a senha.");
    const result = await remoteRequest("change-password", { ...session, password: currentPassword }, { newPassword });
    session.password = newPassword;
    return result;
  }

  async function saveCurrentVault() {
    if (!vault || !session) return;
    syncLegacyCdbs();
    vault.updatedAt = new Date().toISOString();
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const result = await remoteRequest("sync", session, vault, session.revision || 0);
      session.revision = Number(result.revision || session.revision || 0);
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
    const normalizedView = viewName === "investimentos" ? "cdb" : viewName;
    const view = VIEWS[normalizedView] ? normalizedView : "dashboard";
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
    populateSelect($("#fixedCostCategory"), CATEGORIES.map((category) => ({ value: category, label: category })), $("#fixedCostCategory")?.value || "Moradia");
    populateSelect($("#transactionAccount"), accounts.length ? accounts : [{ value: "", label: "Cadastre uma conta primeiro" }], $("#transactionAccount")?.value || "");
    populateSelect($("#debtAccount"), [{ value: "", label: "Sem conta definida" }, ...accounts], $("#debtAccount")?.value || "");
    populateSelect($("#transferSourceAccount"), accounts.length ? accounts : [{ value: "", label: "Cadastre uma conta primeiro" }], $("#transferSourceAccount")?.value || "");
    populateSelect($("#transferDestinationAccount"), accounts.length ? accounts : [{ value: "", label: "Cadastre uma conta primeiro" }], $("#transferDestinationAccount")?.value || "");
    populateSelect($("#fixedAccount"), [{ value: "", label: "Sem conta definida" }, ...accounts], $("#fixedAccount")?.value || "");
    populateSelect($("#cdbAccount"), linkedAccounts.length ? linkedAccounts : [{ value: "", label: "Cadastre uma conta primeiro" }], $("#cdbAccount")?.value || "");
    populateSelect($("#savingsAccount"), savingsAccounts.length ? savingsAccounts : [{ value: "", label: "Cadastre uma conta do tipo poupança" }], $("#savingsAccount")?.value || "");
    populateSelect($("#investmentOperationAccount"), accounts.length ? accounts : [{ value: "", label: "Cadastre uma conta primeiro" }], $("#investmentOperationAccount")?.value || "");
  }

  function transactionsForPeriod(period = currentPeriod()) {
    return vault.transactions.filter((item) => String(item.date || "").startsWith(period));
  }

  function sumTransactions(items, type) {
    return items.filter((item) => item.type === type && !item.transferId).reduce((sum, item) => sum + toAmount(item.amount), 0);
  }

  function transferById(transferId) {
    return vault.transfers.find((item) => item.id === transferId);
  }

  function fixedCostPayment(fixedCostId, period = currentPeriod()) {
    return vault.fixedCostPayments.find((item) => item.fixedCostId === fixedCostId && item.period === period && item.completed !== false);
  }

  function fixedCostAgenda(period = currentPeriod()) {
    return vault.fixedCosts
      .filter((item) => item.active !== false)
      .map((item) => ({ ...item, paid: Boolean(fixedCostPayment(item.id, period)) }))
      .sort((a, b) => Number(a.dueDay || 99) - Number(b.dueDay || 99));
  }

  function fixedCostStats(period = currentPeriod()) {
    const items = fixedCostAgenda(period);
    const total = items.reduce((sum, item) => sum + toAmount(item.amount), 0);
    const paid = items.filter((item) => item.paid).reduce((sum, item) => sum + toAmount(item.amount), 0);
    return { total, paid, pending: Math.max(0, total - paid), items };
  }

  function accountBalance(accountId) {
    const account = vault.accounts.find((item) => item.id === accountId);
    if (!account) return 0;
    return toAmount(account.balance) + vault.transactions.filter((item) => item.accountId === accountId).reduce((sum, item) => sum + (item.type === "entrada" ? toAmount(item.amount) : -toAmount(item.amount)), 0);
  }

  function totalBalance() {
    return vault.accounts.reduce((sum, account) => sum + accountBalance(account.id), 0);
  }

  function totalInvested() {
    return vault.investments.reduce((sum, item) => sum + Math.max(0, toAmount(item.principal)), 0);
  }

  function investmentYield(item) {
    return Math.max(0, toAmount(item?.accumulatedYield ?? item?.reportedYield ?? 0));
  }

  function investmentCurrentValue(item) {
    return Math.max(0, toAmount(item?.principal) + investmentYield(item));
  }

  function investmentHasHistory(item) {
    return Boolean(item?.operations?.length || vault.transactions.some((transaction) => transaction.investmentId === item?.id || transaction.investmentOperationId && transaction.investmentId === item?.id));
  }

  function totalInvestmentValue() {
    return vault.investments.reduce((sum, item) => sum + investmentCurrentValue(item), 0);
  }

  function totalPatrimony() {
    return vault.patrimony.filter((item) => item.active !== false).reduce((sum, item) => sum + Math.max(0, toAmount(item.currentValue)), 0);
  }

  function roundAmount(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function totalFixedCosts() {
    return vault.fixedCosts.filter((item) => item.active !== false).reduce((sum, item) => sum + toAmount(item.amount), 0);
  }

  function totalDebt() {
    return vault.debts.filter((item) => item.active !== false).reduce((sum, item) => sum + toAmount(item.balance), 0);
  }

  function totalDebtInstallments() {
    return vault.debts.filter((item) => item.active !== false).reduce((sum, item) => sum + toAmount(item.installment), 0);
  }

  function investmentTypeLabel(type) {
    return ({ cdb: "CDB", tesouro: "Tesouro Direto", fundo: "Fundo de investimento", acao: "Ações", etf: "ETF", lci: "LCI / LCA", outro: "Outro investimento" }[type] || "Investimento");
  }

  function normalizedRateType(item) {
    const value = String(item?.rateType || "").toLowerCase();
    if (value === "cdi" || value === "cdi-pos" || value === "pós-fixado" || value === "pos-fixado") return "cdi";
    if (value === "pre" || value === "prefixado") return "pre";
    if (value === "manual" || value === "taxa fixa") return "manual";
    return value;
  }

  function investmentProjection(item) {
    const principal = investmentCurrentValue(item);
    const rate = toAmount(item.rate);
    const rateType = normalizedRateType(item);
    let annualRate = 0;
    let label = "";
    if (rateType === "cdi") {
      const benchmarkRate = toAmount(item.benchmarkRate ?? item.cdiRate);
      if (!benchmarkRate) return { monthly: null, annual: null, label: "Informe o CDI base" };
      annualRate = benchmarkRate * rate / 100;
      label = `${rate}% do CDI (${benchmarkRate}% a.a. base)`;
    } else if (rateType === "pre" || rateType === "manual") {
      annualRate = rate;
      label = `${rate}% a.a.`;
    } else {
      return { monthly: null, annual: null, label: "Sem projeção cadastrada" };
    }
    const monthly = principal * (Math.pow(1 + annualRate / 100, 1 / 12) - 1);
    return { monthly, annual: annualRate, label };
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
    const debtTotal = totalDebt();
    const invested = totalInvested();
    const investmentValue = totalInvestmentValue();
    const declaredPatrimony = totalPatrimony();
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
    $("#dashboardWealthMetrics").innerHTML = [
      metricCard("SALDO EM CONTAS", formatShortCurrency(totalBalance()), "dinheiro disponível", "metric-card--accent"),
      metricCard("TOTAL INVESTIDO", formatShortCurrency(invested), `${vault.investments.length} posição(ões)`, "metric-card--positive"),
      metricCard("PATRIMÔNIO DECLARADO", formatShortCurrency(declaredPatrimony), `${vault.patrimony.length} bem(ns) fora das contas`, "metric-card--patrimony"),
      metricCard("DÍVIDAS", formatShortCurrency(debtTotal), debtTotal ? `${vault.debts.filter((item) => item.active !== false).length} dívida(s) ativa(s)` : "nenhuma dívida cadastrada", "metric-card--warning"),
      metricCard("PATRIMÔNIO LÍQUIDO", formatShortCurrency(totalBalance() + investmentValue + declaredPatrimony - debtTotal), "contas + investimentos + bens − dívidas", "")
    ].join("");
    renderCashflow();
    renderCategories(periodTransactions);
    renderUpcomingFixedCosts();
    renderAccountSnapshot(investmentValue);
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
    const grouped = items.filter((item) => item.type === "saida" && !item.transferId).reduce((map, item) => { map[item.category] = (map[item.category] || 0) + toAmount(item.amount); return map; }, {});
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

  function renderAccountSnapshot(invested = 0) {
    const accounts = vault.accounts.slice().sort((a, b) => accountBalance(b.id) - accountBalance(a.id)).slice(0, 4);
    const markup = accounts.length ? accounts.map((account) => `<div class="account-row"><div class="account-row-main"><span class="account-mark">${escapeHtml(account.name.slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(account.name)}</strong><small>${account.type === "poupanca" ? "Poupança" : "Conta corrente"}</small></div></div><strong class="row-value">${formatCurrency(accountBalance(account.id))}</strong></div>`).join("") : `<div class="empty-state"><strong>Cadastre seus bancos.</strong><span>Assim o saldo consolidado fará sentido.</span><button class="link-button" data-view-link="contas">Adicionar conta →</button></div>`;
    const extraRows = [
      accounts.length && invested ? `<div class="account-row"><div class="account-row-main"><span class="account-mark">I</span><div><strong>Investimentos</strong><small>Aplicações separadas</small></div></div><strong class="row-value">${formatCurrency(invested)}</strong></div>` : "",
      accounts.length && totalPatrimony() ? `<div class="account-row"><div class="account-row-main"><span class="account-mark account-mark--patrimony">P</span><div><strong>Bens declarados</strong><small>Fora das contas e investimentos</small></div></div><strong class="row-value">${formatCurrency(totalPatrimony())}</strong></div>` : ""
    ].join("");
    $("#accountSnapshot").innerHTML = markup + extraRows;
  }

  function renderTransactions() {
    const period = currentPeriod();
    const filter = $("#transactionFilter").value;
    const items = transactionsForPeriod(period).filter((item) => filter === "todos" || item.type === filter).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const accountNames = Object.fromEntries(vault.accounts.map((account) => [account.id, account.name]));
    $("#transactionTable").innerHTML = items.length ? `<table class="data-table"><thead><tr><th>DATA</th><th>DESCRIÇÃO</th><th>CATEGORIA</th><th>CONTA</th><th>VALOR</th><th></th></tr></thead><tbody>${items.map((item) => {
      const transfer = item.transferId ? transferById(item.transferId) : null;
      const transferLabel = transfer ? `<span class="status-pill status-pill--blue" title="Movimentação interna entre contas">TRANSFERÊNCIA · ${item.transferRole === "origem" ? "SAÍDA" : "ENTRADA"}</span>` : "";
      const actions = item.investmentOperationId ? `<span class="status-pill status-pill--muted" title="Movimentação controlada pela carteira de investimentos">INVESTIMENTO</span>` : item.transferId ? transferLabel : `<span class="table-actions"><button class="table-action" type="button" data-action="edit-transaction" data-id="${item.id}" title="Editar">✎</button><button class="table-action" type="button" data-action="delete-transaction" data-id="${item.id}" title="Excluir">×</button></span>`;
      const description = transfer ? `${escapeHtml(transfer.description || "Transferência entre contas")}<br><small class="muted-cell">${item.transferRole === "origem" ? `para ${escapeHtml(accountNames[transfer.destinationAccountId] || "outra conta")}` : `de ${escapeHtml(accountNames[transfer.sourceAccountId] || "outra conta")}`}</small>` : `<strong>${escapeHtml(item.description)}</strong>${item.notes ? `<br><small class="muted-cell">${escapeHtml(item.notes)}</small>` : ""}`;
      return `<tr><td>${formatDate(item.date)}</td><td>${description}</td><td>${transfer ? transferLabel : escapeHtml(item.category)}</td><td>${escapeHtml(accountNames[item.accountId] || "—")}</td><td class="number ${item.type === "entrada" ? "positive-number" : "negative-number"}">${item.type === "entrada" ? "+" : "−"}${formatCurrency(item.amount)}</td><td>${actions}</td></tr>`;
    }).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum lançamento em ${monthLabel(period)}.</strong><span>Comece registrando uma entrada ou saída.</span><button class="button button--secondary" type="button" data-action="open-transaction">Adicionar lançamento</button></div>`;
  }

  function renderAccounts() {
    const balance = totalBalance();
    const current = sumTransactions(transactionsForPeriod(), "entrada");
    const invested = totalInvested();
    $("#accountMetrics").innerHTML = [metricCard("SALDO EM CONTAS", formatShortCurrency(balance), "saldo calculado", "metric-card--accent"), metricCard("ENTRADAS DO MÊS", formatShortCurrency(current), "movimentos positivos", "metric-card--positive"), metricCard("TOTAL INVESTIDO", formatShortCurrency(invested), `${vault.investments.length} posição(ões)`, "")].join("");
    $("#accountList").innerHTML = vault.accounts.length ? vault.accounts.map((account) => `<div class="account-row"><div class="account-row-main"><span class="account-mark">${escapeHtml(account.name.slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(account.name)}</strong><small>${account.type === "poupanca" ? "Poupança" : "Conta corrente"}${account.nickname ? ` · ${escapeHtml(account.nickname)}` : ""}</small></div></div><strong class="row-value">${formatCurrency(accountBalance(account.id))}</strong><span class="table-actions"><button class="table-action" type="button" data-action="delete-account" data-id="${account.id}" title="Excluir conta">×</button></span></div>`).join("") : `<div class="empty-state"><strong>Nenhuma conta cadastrada.</strong><span>Cadastre seu primeiro banco para acompanhar os saldos.</span></div>`;
    renderTransfers();
    renderSavingsManagement();
  }

  function renderTransfers() {
    const accountNames = Object.fromEntries(vault.accounts.map((account) => [account.id, account.name]));
    const items = vault.transfers.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12);
    $("#transferTable").innerHTML = items.length ? `<div class="transfer-history-heading"><span class="eyebrow">HISTÓRICO DE TRANSFERÊNCIAS</span><small>As duas pontas permanecem vinculadas aos lançamentos.</small></div><table class="data-table"><thead><tr><th>DATA</th><th>ORIGEM</th><th>DESTINO</th><th>VALOR</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td>${formatDate(item.date)}</td><td><strong>${escapeHtml(accountNames[item.sourceAccountId] || "—")}</strong></td><td>${escapeHtml(accountNames[item.destinationAccountId] || "—")}</td><td class="number">${formatCurrency(item.amount)}</td><td><button class="table-action" type="button" data-action="delete-transfer" data-id="${item.id}" title="Excluir transferência" aria-label="Excluir transferência">×</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhuma transferência registrada.</strong><span>Use o formulário acima para mover dinheiro entre suas contas.</span></div>`;
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
    setMoneyInputValue(fields.manualYield, summary.hasManualCorrection ? summary.config.manualYield : "");
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

  function renderDebts() {
    const active = vault.debts.filter((item) => item.active !== false);
    const balance = active.reduce((sum, item) => sum + toAmount(item.balance), 0);
    const installments = active.reduce((sum, item) => sum + toAmount(item.installment), 0);
    $("#debtMetrics").innerHTML = [metricCard("SALDO DE DÍVIDAS", formatShortCurrency(balance), active.length ? `${active.length} compromisso(s) ativo(s)` : "nenhuma dívida cadastrada", "metric-card--warning"), metricCard("PARCELAS MENSAIS", formatShortCurrency(installments), "valor informado por mês", "metric-card--accent"), metricCard("MÉDIA POR DÍVIDA", formatShortCurrency(active.length ? balance / active.length : 0), active.length ? "saldo atual médio" : "cadastre uma dívida", "")].join("");
    const accountNames = Object.fromEntries(vault.accounts.map((account) => [account.id, account.name]));
    const items = vault.debts.slice().sort((a, b) => Number(a.dueDay || 99) - Number(b.dueDay || 99));
    $("#debtTable").innerHTML = items.length ? `<table class="data-table"><thead><tr><th>DÍVIDA</th><th>CREDOR</th><th>SALDO ATUAL</th><th>PARCELA</th><th>VENC.</th><th>CONTA</th><th>STATUS</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.creditor || "—")}</td><td class="number">${formatCurrency(item.balance)}</td><td class="number">${formatCurrency(item.installment)}</td><td>${item.dueDay ? `Dia ${escapeHtml(item.dueDay)}` : "—"}</td><td>${escapeHtml(accountNames[item.accountId] || "—")}</td><td><span class="status-pill ${item.active !== false ? "status-pill--green" : "status-pill--muted"}">${item.active !== false ? "ATIVA" : "PAUSADA"}</span></td><td><span class="table-actions"><button class="table-action" type="button" data-action="edit-debt" data-id="${item.id}" title="Editar dívida" aria-label="Editar dívida">✎</button><button class="table-action" type="button" data-action="toggle-debt" data-id="${item.id}" title="Ativar ou pausar" aria-label="Ativar ou pausar">↻</button><button class="table-action" type="button" data-action="delete-debt" data-id="${item.id}" title="Excluir dívida" aria-label="Excluir dívida">×</button></span></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhuma dívida cadastrada.</strong><span>Se você tiver parcelas ou saldo devedor, registre aqui para refletir no patrimônio líquido.</span></div>`;
  }

  function renderFixedCosts() {
    const stats = fixedCostStats();
    $("#fixedMetrics").innerHTML = [metricCard("CUSTO FIXO NO MÊS", formatShortCurrency(stats.total), `${stats.items.length} compromisso(s) ativo(s)`, "metric-card--accent"), metricCard("JÁ PAGUEI", formatShortCurrency(stats.paid), "referência marcada na agenda", "metric-card--positive"), metricCard("VOU PAGAR", formatShortCurrency(stats.pending), "ainda não concluído", "metric-card--warning")].join("");
    $("#fixedAgendaPeriod").textContent = monthLabel(currentPeriod());
    $("#fixedAgendaTable").innerHTML = stats.items.length ? `<table class="data-table fixed-agenda-table"><thead><tr><th>VENC.</th><th>DESCRIÇÃO</th><th>CATEGORIA</th><th>VALOR</th><th>STATUS</th><th></th></tr></thead><tbody>${stats.items.map((item) => `<tr class="${item.paid ? "is-completed" : ""}"><td>Dia ${escapeHtml(item.dueDay)}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.category || "Custo fixo")}</td><td class="number">${formatCurrency(item.amount)}</td><td><span class="status-pill ${item.paid ? "status-pill--green" : "status-pill--yellow"}">${item.paid ? "CONCLUÍDO" : "A PAGAR"}</span></td><td><button class="agenda-toggle ${item.paid ? "is-completed" : ""}" type="button" data-action="toggle-fixed-payment" data-id="${item.id}" aria-pressed="${item.paid}">${item.paid ? "Desmarcar" : "Concluído"}</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum custo fixo ativo para ${monthLabel(currentPeriod()).toLowerCase()}.</strong><span>Cadastre um compromisso abaixo para montar sua agenda mensal.</span></div>`;
    const accountNames = Object.fromEntries(vault.accounts.map((account) => [account.id, account.name]));
    const items = vault.fixedCosts.slice().sort((a, b) => Number(a.dueDay) - Number(b.dueDay));
    $("#fixedCostTable").innerHTML = items.length ? `<table class="data-table"><thead><tr><th>VENC.</th><th>DESCRIÇÃO</th><th>CATEGORIA</th><th>CONTA</th><th>VALOR</th><th>STATUS</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td>Dia ${escapeHtml(item.dueDay)}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(accountNames[item.accountId] || "—")}</td><td class="number">${formatCurrency(item.amount)}</td><td><span class="status-pill ${item.active !== false ? "status-pill--green" : "status-pill--muted"}">${item.active !== false ? "ATIVO" : "PAUSADO"}</span></td><td><span class="table-actions"><button class="table-action" type="button" data-action="edit-fixed" data-id="${item.id}" title="Editar custo fixo" aria-label="Editar custo fixo">✎</button><button class="table-action" type="button" data-action="toggle-fixed" data-id="${item.id}" title="Ativar ou pausar" aria-label="Ativar ou pausar">↻</button><button class="table-action" type="button" data-action="delete-fixed" data-id="${item.id}" title="Excluir" aria-label="Excluir custo fixo">×</button></span></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum custo fixo cadastrado.</strong><span>Registre aluguel, assinaturas, contas e outros compromissos mensais.</span></div>`;
  }

  function renderCdb() {
    renderInvestments();
  }

  function renderInvestments() {
    const positions = vault.investments;
    const principal = totalInvested();
    const projections = positions.map((item) => investmentProjection(item)).filter((item) => item.monthly !== null);
    const monthlyProjection = projections.reduce((sum, item) => sum + item.monthly, 0);
    const nextMaturity = positions.filter((item) => item.maturityAt).sort((a, b) => String(a.maturityAt).localeCompare(String(b.maturityAt)))[0]?.maturityAt;
    const projectionMeta = projections.length ? `${projections.length} posição(ões) com estimativa bruta` : positions.length ? "informe o CDI base ou uma taxa" : "cadastre um investimento";
    $("#cdbMetrics").innerHTML = [metricCard("TOTAL INVESTIDO", formatShortCurrency(principal), `${positions.length} posição(ões)`, "metric-card--accent"), metricCard("PROJEÇÃO MENSAL", projections.length ? formatShortCurrency(monthlyProjection) : "—", projectionMeta, "metric-card--positive"), metricCard("PRÓXIMO VENCIMENTO", nextMaturity ? formatDate(nextMaturity) : "—", nextMaturity ? "conforme cadastro" : "nenhum vencimento informado", "")].join("");
    $("#cdbTable").innerHTML = positions.length ? `<table class="data-table investment-table"><thead><tr><th>INVESTIMENTO</th><th>TIPO</th><th>CONTA / BANCO</th><th>APLICADO</th><th>VALOR ATUAL</th><th>REFERÊNCIA</th><th>PROJEÇÃO / MÊS</th><th>VENCIMENTO</th><th>AÇÕES</th></tr></thead><tbody>${positions.map((item) => { const account = accountById(item.accountId); const institution = account ? `${account.name}${account.nickname ? ` · ${account.nickname}` : ""}` : item.bank || "—"; const projection = investmentProjection(item); const rateType = normalizedRateType(item); const rateLabel = rateType === "cdi" ? `${item.rate || 0}% CDI` : rateType === "pre" ? `${item.rate || 0}% a.a.` : item.rate ? `${item.rate}% a.a.` : "—"; const currentValue = investmentCurrentValue(item); const yieldValue = investmentYield(item); return `<tr><td><strong>${escapeHtml(item.name)}</strong>${item.operations?.length ? `<br><small class="muted-cell">${item.operations.length} movimentação(ões) registradas</small>` : ""}</td><td><span class="status-pill status-pill--muted">${escapeHtml(investmentTypeLabel(item.type || "cdb"))}</span></td><td>${escapeHtml(institution)}</td><td class="number">${formatCurrency(item.principal)}</td><td class="number">${formatCurrency(currentValue)}${yieldValue ? `<br><small class="positive-number">+${formatCurrency(yieldValue)} rendimento</small>` : ""}</td><td>${escapeHtml(rateLabel)}${rateType === "cdi" && item.benchmarkRate ? `<br><small class="muted-cell">CDI base: ${escapeHtml(item.benchmarkRate)}% a.a.</small>` : ""}</td><td class="number">${projection.monthly === null ? `<span title="${escapeHtml(projection.label)}">—</span>` : formatCurrency(projection.monthly)}</td><td>${formatDate(item.maturityAt)}</td><td><div class="investment-actions"><button class="investment-action investment-action--aporte" type="button" data-action="open-investment-operation" data-operation-type="aporte" data-id="${item.id}" title="Aplicar neste investimento">Aporte</button><button class="investment-action investment-action--resgate" type="button" data-action="open-investment-operation" data-operation-type="resgate" data-id="${item.id}" title="Resgatar deste investimento">Resgatar</button><button class="investment-action investment-action--rendimento" type="button" data-action="open-investment-operation" data-operation-type="rendimento" data-id="${item.id}" title="Informar rendimento deste investimento">Rendimento</button></div><span class="table-actions investment-edit-actions"><button class="table-action" type="button" data-action="edit-investment" data-id="${item.id}" title="Editar investimento" aria-label="Editar investimento">✎</button><button class="table-action" type="button" data-action="delete-investment" data-id="${item.id}" title="Excluir investimento" aria-label="Excluir investimento">×</button></span></td></tr>`; }).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum investimento cadastrado.</strong><span>Comece pelo CDB ou adicione outro tipo de investimento.</span></div>`;
  }

  function patrimonyTypeLabel(type) {
    return ({ casa: "Casa", carro: "Carro", terra: "Terra", apartamento: "Apartamento", moto: "Moto", outro: "Outro bem" }[type] || "Outro bem");
  }

  function renderPatrimony() {
    const items = vault.patrimony.slice().sort((a, b) => toAmount(b.currentValue) - toAmount(a.currentValue));
    const total = totalPatrimony();
    const categories = new Set(items.map((item) => item.type || "outro"));
    $("#patrimonyMetrics").innerHTML = [
      metricCard("PATRIMÔNIO DECLARADO", formatShortCurrency(total), `${items.length} bem(ns) cadastrado(s)`, "metric-card--patrimony"),
      metricCard("MAIOR BEM", items.length ? formatShortCurrency(items[0].currentValue) : "—", items.length ? items[0].name : "cadastre um item", "metric-card--accent"),
      metricCard("CATEGORIAS", String(categories.size), categories.size ? "tipos de bens registrados" : "nenhuma categoria", "")
    ].join("");
    $("#patrimonyTable").innerHTML = items.length ? `<table class="data-table patrimony-table"><thead><tr><th>BEM</th><th>TIPO</th><th>VALOR ATUAL</th><th>DATA DE REFERÊNCIA</th><th>OBSERVAÇÃO</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td><span class="status-pill status-pill--muted">${escapeHtml(patrimonyTypeLabel(item.type))}</span></td><td class="number">${formatCurrency(item.currentValue)}</td><td>${formatDate(item.referenceDate)}</td><td>${escapeHtml(item.notes || "—")}</td><td><span class="table-actions"><button class="table-action" type="button" data-action="edit-patrimony" data-id="${item.id}" title="Editar bem" aria-label="Editar bem">✎</button><button class="table-action" type="button" data-action="delete-patrimony" data-id="${item.id}" title="Excluir bem" aria-label="Excluir bem">×</button></span></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum bem patrimonial cadastrado.</strong><span>Inclua casa, carro, terra ou outro item pelo valor atual. Isso não altera o saldo de suas contas.</span></div>`;
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
    const expenseItems = periodItems.filter((item) => item.type === "saida" && !item.transferId);
    const grouped = expenseItems.reduce((map, item) => { map[item.category] = (map[item.category] || 0) + toAmount(item.amount); return map; }, {});
    const topCategory = Object.entries(grouped).sort((a, b) => b[1] - a[1])[0];
    const selectedMonth = months[months.length - 1];
    const savings = selectedMonth.income ? Math.round(selectedMonth.rate) : 0;
    const invested = totalInvested();
    const investmentValue = totalInvestmentValue();
    const declaredPatrimony = totalPatrimony();
    const debt = totalDebt();
    const netWorth = totalBalance() + investmentValue + declaredPatrimony - debt;
    $("#analysisHighlights").innerHTML = [
      `<article class="insight-card"><p class="eyebrow">TAXA DE SOBRA</p><h3>${savings}%</h3><p>do que entrou em ${monthLabel(selectedMonth.period)} ficou no caixa.</p></article>`,
      `<article class="insight-card"><p class="eyebrow">MAIOR CATEGORIA</p><h3>${topCategory ? escapeHtml(topCategory[0]) : "—"}</h3><p>${topCategory ? `${formatCurrency(topCategory[1])} em saídas no período.` : "Cadastre saídas para descobrir."}</p></article>`,
      `<article class="insight-card"><p class="eyebrow">TOTAL INVESTIDO</p><h3>${formatShortCurrency(invested)}</h3><p>${vault.investments.length} posição(ões) entre seus investimentos.</p></article>`,
      `<article class="insight-card insight-card--patrimony"><p class="eyebrow">BENS DECLARADOS</p><h3>${formatShortCurrency(declaredPatrimony)}</h3><p>${vault.patrimony.length} item(ns) fora das contas e investimentos.</p></article>`,
      `<article class="insight-card"><p class="eyebrow">PATRIMÔNIO LÍQUIDO</p><h3>${formatShortCurrency(netWorth)}</h3><p>contas + investimentos + bens − ${formatShortCurrency(debt)} em dívidas.</p></article>`
    ].join("");
    const max = Math.max(...months.flatMap((item) => [Math.abs(item.income), Math.abs(item.expense)]), 1);
    $("#analysisBars").innerHTML = months.map((item) => `<div class="analysis-bar-group"><div class="analysis-bar analysis-bar--positive" style="height:${Math.max(3, item.income / max * 100)}%" title="Entradas ${formatCurrency(item.income)}"></div><div class="analysis-bar analysis-bar--negative" style="height:${Math.max(3, item.expense / max * 100)}%" title="Saídas ${formatCurrency(item.expense)}"></div><span class="analysis-bar-label">${monthLabel(item.period).slice(0, 3)}</span></div>`).join("");
    const totalExpense = expenseItems.reduce((sum, item) => sum + toAmount(item.amount), 0);
    const categories = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    $("#analysisCategories").innerHTML = categories.length ? categories.map(([category, amount]) => `<div class="analysis-category"><span>${escapeHtml(category)}</span><div class="analysis-track"><span style="width:${totalExpense ? amount / totalExpense * 100 : 0}%"></span></div><strong>${formatShortCurrency(amount)}</strong></div>`).join("") : `<div class="empty-state"><strong>Sem categorias ainda.</strong><span>Os pesos aparecerão com seus lançamentos.</span></div>`;
    renderInvestmentAnalysis();
    renderPatrimonyAnalysis();
    $("#analysisTable").innerHTML = `<table class="data-table"><thead><tr><th>MÊS</th><th>ENTRADAS</th><th>SAÍDAS</th><th>RESULTADO</th><th>TAXA DE SOBRA</th></tr></thead><tbody>${months.map((item) => `<tr><td><strong>${monthLabel(item.period)}</strong></td><td class="number positive-number">${formatCurrency(item.income)}</td><td class="number negative-number">${formatCurrency(item.expense)}</td><td class="number ${item.result >= 0 ? "positive-number" : "negative-number"}">${formatCurrency(item.result)}</td><td class="number">${item.income ? `${Math.round(item.rate)}%` : "—"}</td></tr>`).join("")}</tbody></table>`;
  }

  function reportText(value) {
    const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
    return text || "não informado";
  }

  function reportMoney(value) {
    return formatCurrency(toAmount(value));
  }

  function reportPercent(value) {
    return `${Number.isFinite(Number(value)) ? Number(value).toFixed(1).replace(".", ",") : "0,0"}%`;
  }

  function reportDateRange(items, field = "date") {
    const dates = items.map((item) => String(item?.[field] || "")).filter(Boolean).sort();
    return dates.length ? `${formatDate(dates[0])} até ${formatDate(dates[dates.length - 1])}` : "não informado";
  }

  function investmentOperationType(transaction) {
    const operation = vault.investments.flatMap((item) => Array.isArray(item.operations) ? item.operations : []).find((item) => item.id === transaction.investmentOperationId);
    return operation?.type || (transaction.type === "entrada" ? "resgate" : "aporte");
  }

  function reportMonthKeys(items) {
    const keys = items.map((item) => String(item?.date || "").slice(0, 7)).filter((key) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key)).sort();
    if (!keys.length) return [currentPeriod()];
    const start = keys[0].split("-").map(Number);
    const end = keys[keys.length - 1].split("-").map(Number);
    const startDate = new Date(start[0], start[1] - 1, 1, 12);
    const endDate = new Date(end[0], end[1] - 1, 1, 12);
    const result = [];
    for (const date = new Date(startDate); date <= endDate; date.setMonth(date.getMonth() + 1)) result.push(monthKey(date));
    return result;
  }

  function buildAiReport() {
    const lines = [];
    const add = (line = "") => lines.push(line);
    const heading = (title) => { add(""); add(`## ${title}`); };
    const addKeyValue = (key, value) => add(`${key}: ${reportText(value)}`);
    const transactions = vault.transactions.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    const financialTransactions = transactions.filter((item) => !item.transferId);
    const investmentTransactions = financialTransactions.filter((item) => item.investmentOperationId);
    const operationalTransactions = financialTransactions.filter((item) => !item.investmentOperationId);
    const incomes = operationalTransactions.filter((item) => item.type === "entrada");
    const expenses = operationalTransactions.filter((item) => item.type === "saida");
    const incomeTotal = incomes.reduce((sum, item) => sum + toAmount(item.amount), 0);
    const expenseTotal = expenses.reduce((sum, item) => sum + toAmount(item.amount), 0);
    const resultTotal = incomeTotal - expenseTotal;
    const months = reportMonthKeys(transactions).map((period) => ({ period, income: 0, expense: 0, result: 0, rate: 0 }));
    const reportMonths = months.map((month) => {
      const items = operationalTransactions.filter((item) => String(item.date || "").startsWith(month.period));
      const investmentItems = investmentTransactions.filter((item) => String(item.date || "").startsWith(month.period));
      const transfers = vault.transfers.filter((item) => String(item.date || "").startsWith(month.period));
      const income = items.filter((item) => item.type === "entrada").reduce((sum, item) => sum + toAmount(item.amount), 0);
      const expense = items.filter((item) => item.type === "saida").reduce((sum, item) => sum + toAmount(item.amount), 0);
      const aportes = investmentItems.filter((item) => investmentOperationType(item) === "aporte").reduce((sum, item) => sum + toAmount(item.amount), 0);
      const resgates = investmentItems.filter((item) => investmentOperationType(item) === "resgate").reduce((sum, item) => sum + toAmount(item.amount), 0);
      return { ...month, income, expense, aportes, resgates, transfers: transfers.reduce((sum, item) => sum + toAmount(item.amount), 0), result: income - expense, rate: income ? (income - expense) / income * 100 : 0 };
    });
    const monthsWithIncome = reportMonths.filter((item) => item.income > 0);
    const positiveMonths = reportMonths.filter((item) => item.result > 0).length;
    const negativeMonths = reportMonths.filter((item) => item.result < 0).length;
    const categoryTotals = expenses.reduce((map, item) => {
      const key = item.category || UNAVAILABLE_CATEGORY;
      map[key] = (map[key] || 0) + toAmount(item.amount);
      return map;
    }, {});
    const rankedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    const topExpense = expenses.slice().sort((a, b) => toAmount(b.amount) - toAmount(a.amount))[0];
    const accountAssets = totalBalance() + totalInvestmentValue() + totalPatrimony();
    const netWorth = accountAssets - totalDebt();
    const activeFixed = vault.fixedCosts.filter((item) => item.active !== false);
    const currentAgenda = fixedCostStats(currentPeriod());
    const recurringExpenseTotal = activeFixed.reduce((sum, item) => sum + toAmount(item.amount), 0);
    const currentMonth = reportMonths[reportMonths.length - 1];
    const rawData = normalizeVault(vault);

    add("RELATÓRIO FINANCEIRO AVANÇADO PARA ANÁLISE POR IA");
    add("Formato: TXT UTF-8 | Fonte: dados informados pelo usuário no aplicativo");
    add(`Gerado em: ${new Date().toISOString()}`);
    add("Instrução para a IA: trate valores calculados como derivados dos dados abaixo, não invente informações ausentes, sinalize incertezas e separe fatos, hipóteses e recomendações.");

    heading("1. CONTEXTO E COBERTURA");
    addKeyValue("Perfil", vault.profile.displayName || session?.username || "não informado");
    addKeyValue("Período dos lançamentos", reportDateRange(transactions));
    addKeyValue("Quantidade de lançamentos", transactions.length);
    addKeyValue("Quantidade de transferências internas", vault.transfers.length);
    addKeyValue("Quantidade de contas", vault.accounts.length);
    addKeyValue("Quantidade de investimentos", vault.investments.length);
    addKeyValue("Quantidade de dívidas", vault.debts.filter((item) => item.active !== false).length);
    addKeyValue("Quantidade de custos fixos ativos", activeFixed.length);
    addKeyValue("Qualidade dos lançamentos", `${transactions.filter((item) => item.date && item.description && toAmount(item.amount) > 0).length} com data, descrição e valor positivo de ${transactions.length}`);
    add("Limitações: saldo de conta parte do saldo inicial informado e aplica os lançamentos registrados; investimentos e patrimônio usam os valores declarados; não há cotação automática, imposto calculado ou confirmação externa de valores.");

    heading("2. RESUMO EXECUTIVO");
    addKeyValue("Entradas operacionais acumuladas", reportMoney(incomeTotal));
    addKeyValue("Saídas operacionais acumuladas", reportMoney(expenseTotal));
    addKeyValue("Resultado operacional acumulado", reportMoney(resultTotal));
    addKeyValue("Aportes em investimentos", reportMoney(reportMonths.reduce((sum, item) => sum + item.aportes, 0)));
    addKeyValue("Resgates de investimentos", reportMoney(reportMonths.reduce((sum, item) => sum + item.resgates, 0)));
    addKeyValue("Transferências internas", reportMoney(vault.transfers.reduce((sum, item) => sum + toAmount(item.amount), 0)));
    addKeyValue("Saldo calculado nas contas", reportMoney(totalBalance()));
    addKeyValue("Valor atual dos investimentos", reportMoney(totalInvestmentValue()));
    addKeyValue("Patrimônio declarado", reportMoney(totalPatrimony()));
    addKeyValue("Dívidas ativas", reportMoney(totalDebt()));
    addKeyValue("Patrimônio líquido estimado", reportMoney(netWorth));
    addKeyValue("Compromissos fixos ativos por mês", reportMoney(recurringExpenseTotal));
    addKeyValue("Taxa de sobra no período selecionado", currentMonth.income ? reportPercent(currentMonth.rate) : "sem entradas informadas");

    heading("3. PADRÕES E INSIGHTS DERIVADOS");
    add(`- No histórico mensal completo (${months.length} competência(s)): ${positiveMonths} mês(es) com resultado positivo, ${negativeMonths} negativo(s) e ${months.length - positiveMonths - negativeMonths} sem resultado financeiro.`);
    if (monthsWithIncome.length) {
      const averageIncome = monthsWithIncome.reduce((sum, item) => sum + item.income, 0) / monthsWithIncome.length;
      const averageExpense = monthsWithIncome.reduce((sum, item) => sum + item.expense, 0) / monthsWithIncome.length;
      add(`- Média mensal entre meses com entrada: ${reportMoney(averageIncome)} de entradas e ${reportMoney(averageExpense)} de saídas.`);
    } else add("- Não há entradas registradas na janela analisada; não é possível estimar renda média ou taxa de sobra.");
    if (rankedCategories.length) {
      const [category, amount] = rankedCategories[0];
      const share = expenseTotal ? amount / expenseTotal * 100 : 0;
      add(`- Maior categoria de saída: ${reportText(category)}, ${reportMoney(amount)} (${reportPercent(share)} das saídas).`);
      if (share >= 40) add("- Concentração relevante: a maior categoria representa pelo menos 40% das saídas; investigar recorrência, necessidade e possibilidade de substituição.");
    }
    if (topExpense) add(`- Maior lançamento de saída: ${reportText(topExpense.description)} em ${formatDate(topExpense.date)}, ${reportMoney(topExpense.amount)} (${reportText(topExpense.category)}).`);
    if (totalDebt() > accountAssets) add("- Alerta patrimonial: as dívidas ativas superam os ativos calculados; priorizar uma visão de liquidez e vencimentos.");
    if (currentAgenda.pending > 0) add(`- Agenda do período selecionado: ${reportMoney(currentAgenda.pending)} em custos fixos ainda não marcados como pagos.`);
    if (expenseTotal > incomeTotal && incomes.length) add("- Alerta de fluxo: as saídas acumuladas superam as entradas acumuladas nos lançamentos registrados.");
    if (!transactions.length) add("- Não há lançamentos; qualquer recomendação deve começar por organizar a coleta de entradas, saídas e datas.");
    add("- Esses insights são alertas exploratórios, não diagnóstico financeiro; a IA deve pedir confirmação quando houver contexto ausente.");

    heading("4. EVOLUÇÃO MENSAL — HISTÓRICO COMPLETO");
    add("mês | entradas_operacionais | saídas_operacionais | aportes | resgates | transferências | resultado_operacional | taxa_de_sobra");
    reportMonths.forEach((item) => add(`${item.period} | ${reportMoney(item.income)} | ${reportMoney(item.expense)} | ${reportMoney(item.aportes)} | ${reportMoney(item.resgates)} | ${reportMoney(item.transfers)} | ${reportMoney(item.result)} | ${item.income ? reportPercent(item.rate) : "não informado"}`));

    heading("5. SAÍDAS POR CATEGORIA");
    add("categoria | total | participação nas saídas | quantidade de lançamentos");
    rankedCategories.forEach(([category, amount]) => {
      const count = expenses.filter((item) => (item.category || UNAVAILABLE_CATEGORY) === category).length;
      add(`${reportText(category)} | ${reportMoney(amount)} | ${reportPercent(expenseTotal ? amount / expenseTotal * 100 : 0)} | ${count}`);
    });
    if (!rankedCategories.length) add("não informado");

    heading("6. CONTAS E LIQUIDEZ");
    add("conta | tipo | saldo inicial informado | saldo calculado | quantidade de movimentos");
    vault.accounts.forEach((account) => add(`${reportText(account.name)} | ${account.type === "poupanca" ? "poupança" : "conta corrente"} | ${reportMoney(account.balance)} | ${reportMoney(accountBalance(account.id))} | ${vault.transactions.filter((item) => item.accountId === account.id).length}`));
    if (!vault.accounts.length) add("não informado");

    heading("7. CUSTOS FIXOS E AGENDA");
    add("custo | categoria | valor mensal | vencimento | conta | ativo");
    activeFixed.forEach((item) => add(`${reportText(item.name)} | ${reportText(item.category)} | ${reportMoney(item.amount)} | dia ${reportText(item.dueDay)} | ${reportText(vault.accounts.find((account) => account.id === item.accountId)?.name)} | sim`));
    add(`Agenda de ${currentPeriod()}: previsto ${reportMoney(currentAgenda.total)} | marcado como pago ${reportMoney(currentAgenda.paid)} | a pagar ${reportMoney(currentAgenda.pending)}`);
    if (!activeFixed.length) add("não informado");

    heading("8. DÍVIDAS");
    add("dívida | saldo | parcela | vencimento | conta | status | observação");
    vault.debts.filter((item) => item.active !== false).forEach((item) => add(`${reportText(item.name)} | ${reportMoney(item.balance)} | ${reportMoney(item.installment)} | dia ${reportText(item.dueDay)} | ${reportText(vault.accounts.find((account) => account.id === item.accountId)?.name)} | ativa | ${reportText(item.notes)}`));
    if (!vault.debts.filter((item) => item.active !== false).length) add("não informado");

    heading("9. INVESTIMENTOS");
    add("investimento | tipo | capital | rendimento informado | valor atual | taxa | vencimento | histórico");
    vault.investments.forEach((item) => add(`${reportText(item.name)} | ${reportText(investmentTypeLabel(item.type))} | ${reportMoney(item.principal)} | ${reportMoney(investmentYield(item))} | ${reportMoney(investmentCurrentValue(item))} | ${reportText(item.rate)} ${reportText(item.rateType)} | ${reportText(item.dueDate)} | ${item.operations?.length || 0} operação(ões)`));
    if (!vault.investments.length) add("não informado");

    heading("10. PATRIMÔNIO DECLARADO");
    add("bem | tipo | valor atual | data de referência | observação");
    vault.patrimony.filter((item) => item.active !== false).forEach((item) => add(`${reportText(item.name)} | ${reportText(patrimonyTypeLabel(item.type))} | ${reportMoney(item.currentValue)} | ${formatDate(item.referenceDate)} | ${reportText(item.notes)}`));
    if (!vault.patrimony.filter((item) => item.active !== false).length) add("não informado");

    heading("11. TRANSFERÊNCIAS INTERNAS");
    add("data | origem | destino | valor | observação");
    vault.transfers.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).forEach((item) => add(`${formatDate(item.date)} | ${reportText(vault.accounts.find((account) => account.id === (item.sourceAccountId || item.fromAccountId))?.name)} | ${reportText(vault.accounts.find((account) => account.id === (item.destinationAccountId || item.toAccountId))?.name)} | ${reportMoney(item.amount)} | ${reportText(item.notes)}`));
    if (!vault.transfers.length) add("não informado");

    heading("12. POUPANÇA");
    add("conta | taxa mensal informada | rendimento manual | data de referência | observação");
    vault.savings.forEach((item) => add(`${reportText(vault.accounts.find((account) => account.id === item.accountId)?.name)} | ${reportText(item.monthlyRate)}% | ${item.manualYield === null || item.manualYield === undefined ? "estimado pelo sistema" : reportMoney(item.manualYield)} | ${formatDate(item.referenceDate)} | ${reportText(item.correctionNote)}`));
    if (!vault.savings.length) add("não informado");

    heading("13. LANÇAMENTOS DETALHADOS");
    add("id | data | tipo | categoria | descrição | valor | conta | transferência | investimento/operação | recorrente | observação");
    transactions.forEach((item) => add(`${reportText(item.id)} | ${formatDate(item.date)} | ${reportText(item.type)} | ${reportText(item.category)} | ${reportText(item.description)} | ${reportMoney(item.amount)} | ${reportText(vault.accounts.find((account) => account.id === item.accountId)?.name)} | ${reportText(item.transferId)} | ${reportText(item.investmentId || item.investmentOperationId)} | ${item.recurring ? "sim" : "não"} | ${reportText(item.notes)}`));
    if (!transactions.length) add("não informado");

    heading("14. PERGUNTAS PARA A IA INVESTIGAR");
    add("1. Quais categorias concentram as maiores saídas e quais têm comportamento recorrente, sazonal ou pontual?");
    add("2. O fluxo de caixa suporta os custos fixos e parcelas atuais? Em quais meses há maior risco de aperto?");
    add("3. Quais lançamentos parecem duplicados, fora do padrão ou sem contexto suficiente para uma decisão?");
    add("4. Como o patrimônio líquido e a liquidez evoluem quando separam contas, investimentos, patrimônio e dívidas?");
    add("5. Quais três ações de baixo risco e alto impacto podem melhorar o próximo mês, deixando claro o dado que sustenta cada uma?");

    heading("15. DADOS BRUTOS EM JSON");
    add(JSON.stringify(rawData, null, 2));
    return `${lines.join("\n").trim()}\n`;
  }

  function exportAiReport() {
    if (!vault) { showToast("Entre no painel para exportar seu relatório.", "error"); return; }
    const content = buildAiReport();
    const blob = new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-financeiro-ia-${todayIso()}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast("Relatório TXT avançado exportado.");
  }

  function renderInvestmentAnalysis() {
    const total = totalInvested();
    const grouped = Object.entries(vault.investments.reduce((map, item) => {
      const key = item.type || "outro";
      map[key] = (map[key] || 0) + toAmount(item.principal);
      return map;
    }, {})).sort((a, b) => b[1] - a[1]);
    $("#analysisInvestments").innerHTML = grouped.length ? `<table class="data-table"><thead><tr><th>TIPO</th><th>POSIÇÕES</th><th>VALOR</th><th>PARTICIPAÇÃO</th></tr></thead><tbody>${grouped.map(([type, amount]) => { const count = vault.investments.filter((item) => (item.type || "outro") === type).length; return `<tr><td><strong>${escapeHtml(investmentTypeLabel(type))}</strong></td><td>${count}</td><td class="number">${formatCurrency(amount)}</td><td class="number">${total ? Math.round(amount / total * 100) : 0}%</td></tr>`; }).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum investimento para analisar.</strong><span>As participações por tipo aparecerão aqui.</span></div>`;
  }

  function renderPatrimonyAnalysis() {
    const total = totalPatrimony();
    const grouped = Object.entries(vault.patrimony.filter((item) => item.active !== false).reduce((map, item) => {
      const key = item.type || "outro";
      map[key] = (map[key] || 0) + Math.max(0, toAmount(item.currentValue));
      return map;
    }, {})).sort((a, b) => b[1] - a[1]);
    $("#analysisPatrimony").innerHTML = grouped.length ? `<table class="data-table"><thead><tr><th>TIPO DE BEM</th><th>ITENS</th><th>VALOR</th><th>PARTICIPAÇÃO</th></tr></thead><tbody>${grouped.map(([type, amount]) => { const count = vault.patrimony.filter((item) => item.active !== false && (item.type || "outro") === type).length; return `<tr><td><strong>${escapeHtml(patrimonyTypeLabel(type))}</strong></td><td>${count}</td><td class="number">${formatCurrency(amount)}</td><td class="number">${total ? Math.round(amount / total * 100) : 0}%</td></tr>`; }).join("")}</tbody></table>` : `<div class="empty-state"><strong>Nenhum bem para analisar.</strong><span>As categorias e a participação aparecerão aqui depois do primeiro cadastro.</span></div>`;
  }

  function renderSettings() {
    $("#profileDisplayName").value = vault.profile.displayName || "";
    $("#storageTitle").textContent = "Planilha sincronizada";
    $("#storagePill").textContent = "ONLINE";
    $("#storageDescription").textContent = "Os lançamentos são gravados na planilha e recebem uma revisão permanente no histórico online.";
    $("#storageDetail").textContent = "A planilha online é a fonte oficial dos seus dados.";
  }

  function renderAll() {
    if (!vault) return;
    setupPeriodSelect();
    refreshFormSelects();
    renderDashboard();
    renderTransactions();
    renderAccounts();
    renderDebts();
    renderFixedCosts();
    renderInvestments();
    renderPatrimony();
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
    if (form.id === "transferForm") {
      $("input[name='date']", form).value = todayIso();
    }
    if (form.id === "fixedCostForm") {
      $("input[name='active']", form).checked = true;
      setFormMode(form, "fixed", false);
    }
    if (form.id === "debtForm") {
      $("input[name='active']", form).checked = true;
      setFormMode(form, "debt", false);
    }
    if (form.id === "cdbForm") {
      $("input[name='startedAt']", form).value = todayIso();
      $("select[name='investmentType']", form).value = "cdb";
      $("select[name='rateType']", form).value = "cdi";
      $("input[name='principal']", form).disabled = false;
      $("select[name='accountId']", form).disabled = false;
      $("input[name='principal']", form).removeAttribute("title");
      $("select[name='accountId']", form).removeAttribute("title");
      setFormMode(form, "investment", false);
    }
    if (form.id === "patrimonyForm") {
      $("input[name='referenceDate']", form).value = todayIso();
      $("select[name='type']", form).value = "casa";
      setFormMode(form, "patrimony", false);
    }
  }

  function setFormMode(form, entity, editing) {
    const title = $("h3", form.closest(".form-panel"));
    const eyebrow = $(".eyebrow", form.closest(".form-panel"));
    const submit = $("button[type='submit']", form);
    const cancel = $("[data-action='cancel-form']", form);
    if (entity === "fixed") {
      if (eyebrow) eyebrow.textContent = editing ? "EDITAR COMPROMISSO" : "NOVO COMPROMISSO";
      if (title) title.textContent = editing ? "Editar custo fixo" : "Cadastrar custo fixo";
      if (submit) submit.textContent = editing ? "Salvar alterações" : "Salvar custo fixo";
    } else if (entity === "debt") {
      if (eyebrow) eyebrow.textContent = editing ? "EDITAR DÍVIDA" : "NOVA DÍVIDA";
      if (title) title.textContent = editing ? "Editar dívida" : "Cadastrar dívida";
      if (submit) submit.textContent = editing ? "Salvar alterações" : "Salvar dívida";
    } else {
      if (eyebrow) eyebrow.textContent = editing ? "EDITAR INVESTIMENTO" : "NOVO INVESTIMENTO";
      if (title) title.textContent = editing ? "Editar investimento" : "Adicionar investimento";
      if (submit) submit.textContent = editing ? "Salvar alterações" : "Salvar investimento";
    }
    if (entity === "patrimony") {
      if (eyebrow) eyebrow.textContent = editing ? "EDITAR BEM" : "NOVO BEM";
      if (title) title.textContent = editing ? "Editar patrimônio" : "Adicionar patrimônio";
      if (submit) submit.textContent = editing ? "Salvar alterações" : "Salvar bem";
    }
    if (cancel) cancel.classList.toggle("is-hidden", !editing);
  }

  function fillDefaultForms() {
    clearForm($("#transactionForm"));
    clearForm($("#transferForm"));
    clearForm($("#debtForm"));
    clearForm($("#cdbForm"));
    clearForm($("#patrimonyForm"));
  }

  async function deleteById(collection, id, message) {
    const target = vault[collection].find((item) => item.id === id);
    if (collection === "transactions" && target?.investmentOperationId) { showToast("Este lançamento pertence a uma operação de investimento e não pode ser removido isoladamente.", "error"); return; }
    if (!window.confirm(message)) return;
    vault[collection] = vault[collection].filter((item) => item.id !== id);
    if (collection === "fixedCosts") vault.fixedCostPayments = vault.fixedCostPayments.filter((item) => item.fixedCostId !== id);
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

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    if (data.newPassword !== data.newPasswordConfirm) { showToast("As novas senhas não conferem.", "error"); return; }
    if (data.newPassword.length < 8) { showToast("A nova senha precisa ter pelo menos 8 caracteres.", "error"); return; }
    const submit = $("button[type='submit']", form);
    submit.disabled = true;
    try {
      await changeRemotePassword(data.currentPassword, data.newPassword);
      form.reset();
      showToast("Senha atualizada com segurança.");
    } catch (error) {
      showToast(error.message || "Não foi possível atualizar a senha.", "error");
    } finally {
      submit.disabled = false;
    }
  }

  async function handleTransactionSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.accountId) { showToast("Cadastre uma conta antes de lançar um movimento.", "error"); setView("contas"); return; }
    const linkedTransaction = vault.transactions.find((item) => item.id === form.dataset.editId && item.investmentOperationId);
    if (linkedTransaction) { showToast("Este lançamento pertence a uma operação de investimento. Use Aporte ou Resgatar na carteira.", "error"); return; }
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
    if (item.investmentOperationId) { showToast("Este lançamento pertence a uma operação de investimento. Use Aporte ou Resgatar na carteira.", "error"); return; }
    setView("lancamentos");
    const form = $("#transactionForm");
    form.dataset.editId = item.id;
    $("input[name='date']", form).value = item.date || todayIso();
    setMoneyInputValue($("input[name='amount']", form), item.amount);
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

  async function handleTransferSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const source = accountById(data.sourceAccountId);
    const destination = accountById(data.destinationAccountId);
    const amount = roundAmount(toAmount(data.amount));
    if (!source || !destination) { showToast("Selecione as duas contas da transferência.", "error"); return; }
    if (source.id === destination.id) { showToast("A conta de origem e a conta de destino precisam ser diferentes.", "error"); return; }
    if (amount <= 0) { showToast("Informe um valor maior que zero.", "error"); return; }
    const transferId = uid("transfer");
    const date = data.date || todayIso();
    const description = data.description?.trim() || `Transferência para ${destination.name}`;
    const notes = data.notes?.trim() || "";
    vault.transfers.push({ id: transferId, date, description, sourceAccountId: source.id, destinationAccountId: destination.id, amount, notes, createdAt: new Date().toISOString() });
    vault.transactions.push(
      { id: uid("tx"), date, description, category: "Transferências", accountId: source.id, amount, type: "saida", notes, recurring: false, transferId, transferRole: "origem" },
      { id: uid("tx"), date, description, category: "Transferências", accountId: destination.id, amount, type: "entrada", notes, recurring: false, transferId, transferRole: "destino" }
    );
    try {
      await saveCurrentVault();
    } catch (error) {
      vault.transfers = vault.transfers.filter((item) => item.id !== transferId);
      vault.transactions = vault.transactions.filter((item) => item.transferId !== transferId);
      showToast(error.message || "A transferência não foi sincronizada.", "error");
      return;
    }
    clearForm(form);
    renderAll();
    showToast("Transferência registrada nas duas contas.");
  }

  async function deleteTransfer(transferId) {
    const transfer = transferById(transferId);
    if (!transfer) return;
    if (!window.confirm("Excluir esta transferência e as duas pontas vinculadas nos lançamentos?")) return;
    const previousTransfers = vault.transfers;
    const previousTransactions = vault.transactions;
    vault.transfers = vault.transfers.filter((item) => item.id !== transferId);
    vault.transactions = vault.transactions.filter((item) => item.transferId !== transferId);
    try {
      await saveCurrentVault();
    } catch (error) {
      vault.transfers = previousTransfers;
      vault.transactions = previousTransactions;
      renderAll();
      return;
    }
    renderAll();
    showToast("Transferência removida.");
  }

  async function handleDebtSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const record = { id: form.dataset.editId || uid("debt"), name: data.name.trim(), creditor: data.creditor?.trim() || "", balance: toAmount(data.balance), installment: toAmount(data.installment), dueDay: data.dueDay ? Number(data.dueDay) : null, accountId: data.accountId || "", active: data.active === "on" };
    const existingIndex = vault.debts.findIndex((item) => item.id === form.dataset.editId);
    if (existingIndex >= 0) vault.debts[existingIndex] = { ...vault.debts[existingIndex], ...record };
    else vault.debts.push(record);
    await saveCurrentVault();
    clearForm(form);
    renderAll();
    showToast(existingIndex >= 0 ? "Dívida atualizada." : "Dívida cadastrada.");
  }

  async function handleFixedSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const record = { id: form.dataset.editId || uid("fixed"), name: data.name.trim(), category: normalizeLaunchCategory(data.category), amount: toAmount(data.amount), dueDay: Number(data.dueDay), accountId: data.accountId || "", active: data.active === "on" };
    const existingIndex = vault.fixedCosts.findIndex((item) => item.id === form.dataset.editId);
    if (existingIndex >= 0) vault.fixedCosts[existingIndex] = { ...vault.fixedCosts[existingIndex], ...record };
    else vault.fixedCosts.push(record);
    await saveCurrentVault();
    clearForm(form);
    renderAll();
    showToast(existingIndex >= 0 ? "Custo fixo atualizado." : "Custo fixo salvo.");
  }

  async function toggleFixedPayment(fixedCostId) {
    const fixedCost = vault.fixedCosts.find((item) => item.id === fixedCostId && item.active !== false);
    if (!fixedCost) return;
    const period = currentPeriod();
    const previousPayments = vault.fixedCostPayments;
    const existingIndex = vault.fixedCostPayments.findIndex((item) => item.fixedCostId === fixedCostId && item.period === period);
    if (existingIndex >= 0) vault.fixedCostPayments.splice(existingIndex, 1);
    else vault.fixedCostPayments.push({ id: uid("fixed-payment"), fixedCostId, period, completed: true, completedAt: new Date().toISOString() });
    try {
      await saveCurrentVault();
    } catch (error) {
      vault.fixedCostPayments = previousPayments;
      renderAll();
      return;
    }
    renderAll();
    showToast(existingIndex >= 0 ? "Pagamento desmarcado na agenda." : "Pagamento marcado como concluído na agenda.");
  }

  async function handleCdbSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const existingInvestment = vault.investments.find((item) => item.id === form.dataset.editId);
    const hasHistory = investmentHasHistory(existingInvestment);
    const account = accountById(hasHistory ? existingInvestment.accountId : data.accountId);
    if (!account) { showToast("Cadastre e selecione a conta que guarda este CDB.", "error"); setView("contas"); return; }
    const record = { id: form.dataset.editId || uid("investment"), type: data.investmentType || "cdb", name: data.name.trim(), accountId: account.id, bank: account.name, principal: hasHistory ? existingInvestment.principal : toAmount(data.principal), rate: toAmount(data.rate), rateType: data.rateType || "none", benchmarkRate: toAmount(data.benchmarkRate), startedAt: data.startedAt, maturityAt: data.maturityAt || "", liquidity: data.liquidity || "" };
    const existingIndex = vault.investments.findIndex((item) => item.id === form.dataset.editId);
    if (existingIndex >= 0) vault.investments[existingIndex] = { ...vault.investments[existingIndex], ...record };
    else vault.investments.push(record);
    await saveCurrentVault();
    clearForm(form);
    renderAll();
    showToast(existingIndex >= 0 ? "Investimento atualizado." : "Investimento cadastrado.");
  }

  async function handlePatrimonySubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const value = roundAmount(toAmount(data.currentValue));
    if (!data.name?.trim()) { showToast("Informe o nome do bem patrimonial.", "error"); return; }
    if (value < 0) { showToast("O valor do bem não pode ser negativo.", "error"); return; }
    const record = { id: form.dataset.editId || uid("patrimony"), name: data.name.trim(), type: data.type || "outro", currentValue: value, referenceDate: data.referenceDate || todayIso(), notes: data.notes?.trim() || "", active: true, updatedAt: new Date().toISOString() };
    const existingIndex = vault.patrimony.findIndex((item) => item.id === form.dataset.editId);
    if (existingIndex >= 0) vault.patrimony[existingIndex] = { ...vault.patrimony[existingIndex], ...record };
    else vault.patrimony.push(record);
    await saveCurrentVault();
    clearForm(form);
    renderAll();
    showToast(existingIndex >= 0 ? "Bem patrimonial atualizado." : "Bem patrimonial salvo.");
  }

  function editPatrimony(id) {
    const item = vault.patrimony.find((patrimony) => patrimony.id === id);
    if (!item) return;
    setView("patrimonio");
    const form = $("#patrimonyForm");
    form.dataset.editId = item.id;
    $("input[name='name']", form).value = item.name || "";
    $("select[name='type']", form).value = item.type || "outro";
    setMoneyInputValue($("input[name='currentValue']", form), item.currentValue);
    $("input[name='referenceDate']", form).value = item.referenceDate || todayIso();
    $("textarea[name='notes']", form).value = item.notes || "";
    setFormMode(form, "patrimony", true);
    form.closest(".form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Edite os campos e salve novamente.");
  }

  function operationLabel(type) {
    return ({ aporte: "Aporte", resgate: "Resgate", rendimento: "Rendimento" }[type] || "Movimentação");
  }

  function closeInvestmentOperation() {
    const dialog = $("#investmentOperationDialog");
    const form = $("#investmentOperationForm");
    if (dialog?.open) dialog.close();
    if (form) form.reset();
  }

  function openInvestmentOperation(id, type) {
    const item = vault.investments.find((investment) => investment.id === id);
    const dialog = $("#investmentOperationDialog");
    const form = $("#investmentOperationForm");
    if (!item || !dialog || !form) return;
    refreshFormSelects();
    const account = accountById(item.accountId);
    form.dataset.investmentId = item.id;
    form.dataset.operationType = type;
    $("#investmentOperationType").value = type;
    $("#investmentOperationEyebrow").textContent = `${operationLabel(type).toUpperCase()} NO INVESTIMENTO`;
    $("#investmentOperationTitle").textContent = `${operationLabel(type)} · ${item.name}`;
    $("#investmentOperationSubtitle").textContent = type === "rendimento" ? "Informe o rendimento já conferido no extrato, sem misturá-lo ao capital aportado." : type === "aporte" ? "Some uma nova aplicação a esta mesma posição e mantenha as movimentações anteriores." : "Registre uma retirada parcial ou total sem apagar o histórico desta posição.";
    $("#investmentOperationCurrentValue").textContent = formatCurrency(investmentCurrentValue(item));
    $("#investmentOperationDate").value = todayIso();
    $("#investmentOperationAccount").value = account?.id || "";
    const accountField = $("#investmentOperationAccountField");
    const accountLabel = $("#investmentOperationAccountLabel");
    const accountHelp = $("#investmentOperationAccountHelp");
    const accountSelect = $("#investmentOperationAccount");
    const hasAccounts = vault.accounts.length > 0;
    accountField.classList.toggle("is-hidden", type === "rendimento");
    accountSelect.required = type !== "rendimento";
    accountLabel.textContent = type === "aporte" ? "Conta de origem" : "Conta de destino";
    accountHelp.textContent = type === "aporte" ? "Será criado um lançamento de saída na conta escolhida." : "Será criado um lançamento de entrada na conta escolhida.";
    $("#investmentOperationHint").textContent = type === "rendimento" ? "O rendimento informado aumenta o valor atual da posição. Nenhum lançamento é criado na conta enquanto o valor não for resgatado." : type === "aporte" ? "O aporte aumenta o capital aplicado e reduz o saldo da conta de origem pelo mesmo valor." : `Disponível para resgate: ${formatCurrency(investmentCurrentValue(item))}. O saldo da posição e a conta de destino serão atualizados juntos.`;
    if (type !== "rendimento" && !hasAccounts) { showToast("Cadastre uma conta antes de registrar este movimento.", "error"); setView("contas"); return; }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "open");
    $("#investmentOperationAmount").focus();
  }

  async function handleInvestmentOperationSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const type = form.dataset.operationType || $("#investmentOperationType").value;
    const item = vault.investments.find((investment) => investment.id === form.dataset.investmentId);
    const data = Object.fromEntries(new FormData(form).entries());
    const amount = roundAmount(toAmount(data.amount));
    if (!item || !type) { closeInvestmentOperation(); return; }
    if (amount <= 0) { showToast("Informe um valor maior que zero.", "error"); return; }
    if (type !== "rendimento" && !data.accountId) { showToast("Selecione a conta do movimento.", "error"); return; }
    const before = JSON.parse(JSON.stringify(item));
    const principalBefore = Math.max(0, toAmount(item.principal));
    const yieldBefore = investmentYield(item);
    const currentValueBefore = principalBefore + yieldBefore;
    if (type === "resgate" && amount > currentValueBefore + 0.005) { showToast(`O resgate não pode ultrapassar ${formatCurrency(currentValueBefore)}.`, "error"); return; }
    const operation = { id: uid("investment-operation"), type, amount, date: data.date || todayIso(), note: data.note?.trim() || "", accountId: data.accountId || "", createdAt: new Date().toISOString() };
    if (type === "aporte") item.principal = roundAmount(principalBefore + amount);
    if (type === "rendimento") item.accumulatedYield = roundAmount(yieldBefore + amount);
    if (type === "resgate") {
      const principalReduction = Math.min(principalBefore, amount);
      item.principal = roundAmount(principalBefore - principalReduction);
      item.accumulatedYield = roundAmount(Math.max(0, yieldBefore - (amount - principalReduction)));
    }
    operation.principalAfter = item.principal;
    operation.yieldAfter = investmentYield(item);
    operation.balanceAfter = investmentCurrentValue(item);
    item.operations = [...(Array.isArray(item.operations) ? item.operations : []), operation];
    item.updatedAt = new Date().toISOString();
    if (type === "aporte" || type === "resgate") {
      vault.transactions.push({ id: uid("tx"), date: operation.date, description: `${operationLabel(type)} · ${item.name}`, category: "Investimentos", accountId: operation.accountId, amount, type: type === "aporte" ? "saida" : "entrada", notes: operation.note, recurring: false, investmentOperationId: operation.id, investmentId: item.id });
    }
    try {
      await saveCurrentVault();
    } catch (error) {
      Object.keys(item).forEach((key) => delete item[key]);
      Object.assign(item, before);
      vault.transactions = vault.transactions.filter((transaction) => transaction.investmentOperationId !== operation.id);
      showToast(error.message || "A movimentação não foi sincronizada.", "error");
      return;
    }
    closeInvestmentOperation();
    renderAll();
    showToast(type === "aporte" ? "Aporte registrado no investimento." : type === "resgate" ? "Resgate registrado e lançado na conta." : "Rendimento informado no investimento.");
  }

  function editFixed(id) {
    const item = vault.fixedCosts.find((fixed) => fixed.id === id);
    if (!item) return;
    setView("fixos");
    const form = $("#fixedCostForm");
    form.dataset.editId = item.id;
    $("input[name='name']", form).value = item.name || "";
    setMoneyInputValue($("input[name='amount']", form), item.amount);
    $("input[name='dueDay']", form).value = item.dueDay;
    $("select[name='category']", form).value = normalizeLaunchCategory(item.category);
    $("select[name='accountId']", form).value = item.accountId || "";
    $("input[name='active']", form).checked = item.active !== false;
    setFormMode(form, "fixed", true);
    form.closest(".form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Edite os campos e salve novamente.");
  }

  function editDebt(id) {
    const item = vault.debts.find((debt) => debt.id === id);
    if (!item) return;
    setView("dividas");
    const form = $("#debtForm");
    form.dataset.editId = item.id;
    $("input[name='name']", form).value = item.name || "";
    $("input[name='creditor']", form).value = item.creditor || "";
    setMoneyInputValue($("input[name='balance']", form), item.balance);
    setMoneyInputValue($("input[name='installment']", form), item.installment);
    $("input[name='dueDay']", form).value = item.dueDay || "";
    $("select[name='accountId']", form).value = item.accountId || "";
    $("input[name='active']", form).checked = item.active !== false;
    setFormMode(form, "debt", true);
    form.closest(".form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Edite os campos e salve novamente.");
  }

  function editInvestment(id) {
    const item = vault.investments.find((investment) => investment.id === id);
    if (!item) return;
    setView("cdb");
    const form = $("#cdbForm");
    form.dataset.editId = item.id;
    $("input[name='name']", form).value = item.name || "";
    $("select[name='investmentType']", form).value = item.type || "cdb";
    $("select[name='accountId']", form).value = item.accountId || "";
    setMoneyInputValue($("input[name='principal']", form), item.principal);
    $("input[name='rate']", form).value = item.rate ?? "";
    $("select[name='rateType']", form).value = normalizedRateType(item) || "none";
    $("input[name='benchmarkRate']", form).value = item.benchmarkRate ?? item.cdiRate ?? "";
    $("input[name='startedAt']", form).value = item.startedAt || todayIso();
    $("input[name='maturityAt']", form).value = item.maturityAt || "";
    $("select[name='liquidity']", form).value = item.liquidity || "Outro";
    const hasHistory = investmentHasHistory(item);
    $("input[name='principal']", form).disabled = hasHistory;
    $("select[name='accountId']", form).disabled = hasHistory;
    if (hasHistory) {
      $("input[name='principal']", form).title = "Protegido pelo histórico. Use Aporte ou Resgatar.";
      $("select[name='accountId']", form).title = "Protegido pelo histórico da posição.";
      showToast("Capital e conta ficam protegidos porque esta posição já possui movimentações. Use Aporte ou Resgatar para alterar o saldo.");
    }
    setFormMode(form, "investment", true);
    form.closest(".form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Edite os campos e salve novamente.");
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
    if (!window.confirm("Apagar todos os lançamentos, transferências, contas, dívidas, custos fixos, agenda, investimentos, patrimônio e configurações de poupança deste usuário? Essa ação não pode ser desfeita.")) return;
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
      vault.transfers.some((item) => item.sourceAccountId === accountId || item.destinationAccountId === accountId),
      vault.debts.some((item) => item.accountId === accountId),
      vault.fixedCosts.some((item) => item.accountId === accountId),
      vault.investments.some((item) => item.accountId === accountId),
      vault.savings.some((item) => item.accountId === accountId)
    ];
    if (references.some(Boolean)) { showToast("Não exclua uma conta que ainda está vinculada a lançamentos, transferências, custos, investimentos, dívidas ou poupança.", "error"); return; }
    await deleteById("accounts", accountId, `Excluir a conta ${account.name}?`);
  }

  async function deleteInvestment(id) {
    const item = vault.investments.find((investment) => investment.id === id);
    if (!item) return;
    if (investmentHasHistory(item)) { showToast("Este investimento possui histórico de movimentações e não pode ser apagado. Use as ações da carteira para continuar registrando-o.", "error"); return; }
    await deleteById("investments", id, "Excluir este investimento?");
  }

  function bindEvents() {
    $("#authForm").addEventListener("submit", handleAuthSubmit);
    $("#passwordForm").addEventListener("submit", handlePasswordSubmit);
    $("#authModeToggle").addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
    $("#logoutButton").addEventListener("click", leaveApp);
    $("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("is-open"));
    $("#periodSelect").addEventListener("change", renderAll);
    $("#transactionFilter").addEventListener("change", renderTransactions);
    $("#transactionForm").addEventListener("submit", handleTransactionSubmit);
    $("#accountForm").addEventListener("submit", handleAccountSubmit);
    $("#transferForm").addEventListener("submit", handleTransferSubmit);
    $("#debtForm").addEventListener("submit", handleDebtSubmit);
    $("#fixedCostForm").addEventListener("submit", handleFixedSubmit);
    $("#cdbForm").addEventListener("submit", handleCdbSubmit);
    $("#patrimonyForm").addEventListener("submit", handlePatrimonySubmit);
    $("#investmentOperationForm").addEventListener("submit", handleInvestmentOperationSubmit);
    $("#investmentOperationDialog").addEventListener("cancel", (event) => { event.preventDefault(); closeInvestmentOperation(); });
    $("#investmentOperationDialog").addEventListener("close", () => $("#investmentOperationForm").reset());
    $("#savingsForm").addEventListener("submit", handleSavingsSubmit);
    $("#savingsAccount").addEventListener("change", fillSavingsForm);
    $("#profileForm").addEventListener("submit", handleProfileSubmit);
    setupMoneyInputs();
    document.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-view-target], [data-view-link], [data-action]");
      if (!target) return;
      if (target.dataset.viewTarget || target.dataset.viewLink) { setView(target.dataset.viewTarget || target.dataset.viewLink); return; }
      const action = target.dataset.action;
      if (action === "open-transaction") { setView("lancamentos"); window.setTimeout(() => $("#transactionFormPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); }
      if (action === "export-ai-report") exportAiReport();
      if (action === "clear-all") await clearAllData();
      if (action === "delete-transaction") await deleteById("transactions", target.dataset.id, "Excluir este lançamento?");
      if (action === "delete-transfer") await deleteTransfer(target.dataset.id);
      if (action === "edit-transaction") editTransaction(target.dataset.id);
      if (action === "delete-account") await deleteAccount(target.dataset.id);
      if (action === "edit-debt") editDebt(target.dataset.id);
      if (action === "delete-debt") await deleteById("debts", target.dataset.id, "Excluir esta dívida?");
      if (action === "toggle-debt") { const item = vault.debts.find((debt) => debt.id === target.dataset.id); if (item) { item.active = item.active === false; await saveCurrentVault(); renderAll(); showToast(item.active ? "Dívida ativada." : "Dívida pausada."); } }
      if (action === "delete-fixed") await deleteById("fixedCosts", target.dataset.id, "Excluir este custo fixo?");
      if (action === "edit-fixed") editFixed(target.dataset.id);
      if (action === "cancel-form") { clearForm(target.closest("form")); renderAll(); }
      if (action === "edit-investment") editInvestment(target.dataset.id);
      if (action === "delete-investment") await deleteInvestment(target.dataset.id);
      if (action === "edit-patrimony") editPatrimony(target.dataset.id);
      if (action === "delete-patrimony") await deleteById("patrimony", target.dataset.id, "Excluir este bem patrimonial?");
      if (action === "open-investment-operation") openInvestmentOperation(target.dataset.id, target.dataset.operationType);
      if (action === "close-investment-operation") closeInvestmentOperation();
      if (action === "toggle-fixed") { const item = vault.fixedCosts.find((fixed) => fixed.id === target.dataset.id); if (item) { item.active = item.active === false; await saveCurrentVault(); renderAll(); showToast(item.active ? "Custo fixo ativado." : "Custo fixo pausado."); } }
      if (action === "toggle-fixed-payment") await toggleFixedPayment(target.dataset.id);
    });
  }

  function start() {
    if (!window.crypto?.subtle) { setAuthNotice("Este navegador não oferece a conexão segura necessária."); return; }
    if (!CONFIG.apiUrl) { setAuthNotice("O armazenamento online ainda não foi configurado."); return; }
    bindEvents();
    setupPeriodSelect();
    fillDefaultForms();
    const hashView = window.location.hash.replace("#", "");
    if (VIEWS[hashView] || hashView === "cdb") setView(hashView);
  }

  start();
})();
