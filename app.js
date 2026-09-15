import {
  SCENARIO_ORDER,
  aggregateYears,
  euriborAtMonth,
  offerKey,
  offerTan,
  simulateOffer,
  validateScenarioConfig
} from './scenario-engine.mjs';
import {
  MAX_SELECTION,
  coreContext,
  contextsMatch,
  parsePersistentState,
  serializePersistentState,
  toggleOfferSelection
} from './selection-state.mjs';

const API_URL = 'https://morgana.comparaja.pt/products';
const STORAGE_KEY = 'credito-claro:comparison:v2';
const BANK_NAMES = {
  BCTT: 'Banco CTT', CCAM: 'Crédito Agrícola', MBCP: 'Millennium bcp', CGD: 'Caixa Geral de Depósitos',
  ABCA: 'ABANCA', BBIC: 'Banco BIC', BPI: 'Banco BPI', SDTT: 'Santander', NVBC: 'novobanco',
  BMTP: 'Banco Montepio', BUCI: 'Banco UCI'
};
const RATE_NAMES = { mixed: 'Taxa mista', variable: 'Taxa variável', fixed: 'Taxa fixa' };
const EURIBOR_NAMES = { threemonth: '3 meses', sixmonth: '6 meses', twelvemonth: '12 meses' };
const SCENARIO_NAMES = { best: 'Best', base: 'Base', worst: 'Worst' };
const SCENARIO_COLORS = { best: '#12836b', base: '#4c78b8', worst: '#d96055' };
const OFFER_COLORS = ['#0d806c', '#5379bd', '#d1783e', '#8b64ae'];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const pct = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const compact = new Intl.NumberFormat('pt-PT', { notation: 'compact', maximumFractionDigits: 1 });
const number = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 });

const state = {
  products: [],
  params: null,
  requestController: null,
  selected: [],
  selectionContext: null,
  scenarioConfig: null,
  scenarioResults: null,
  chartScenario: 'base',
  activeView: 'offers',
  openOfferKey: null,
  toastTimer: null
};

function bankName(product) {
  if (product?.bankName) return product.bankName;
  const prefix = String(product?.productId || '').replace(/\d/g, '');
  return BANK_NAMES[prefix] || `Banco ${prefix || Number(product?.priority || 0) + 1}`;
}

function rateType(product) {
  return String(product?.attributes?.rateType || '').toLowerCase();
}

function formatRate(value) {
  return Number.isFinite(Number(value)) ? `${pct.format(Number(value))}%` : '—';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function getParams() {
  return {
    deedAmount: Number($('#deedAmount').value),
    loanAmount: Number($('#loanAmount').value),
    income: Number($('#income').value),
    loanTerm: Number($('#loanTerm').value),
    rateType: $('input[name="rateType"]:checked')?.value || 'mixed',
    euriborType: $('input[name="euriborType"]:checked')?.value || 'sixMonth',
    orderBy: 'attributes.installment'
  };
}

function paramsAreValid(params) {
  return params.deedAmount >= 10000 && params.loanAmount >= 5000 && params.income > 0 && params.loanTerm >= 1 && params.loanTerm <= 40;
}

function updateLoanIndicators(source = 'loan') {
  const deed = Number($('#deedAmount').value) || 0;
  if (source === 'capital') $('#loanAmount').value = Math.max(deed - (Number($('#initialCapital').value) || 0), 0);
  if (source === 'loan' || source === 'deed') $('#initialCapital').value = Math.max(deed - (Number($('#loanAmount').value) || 0), 0);
  const loan = Number($('#loanAmount').value) || 0;
  const ltv = deed ? (loan / deed) * 100 : 0;
  $('#downPayment').textContent = eur.format(Math.max(deed - loan, 0));
  $('#ltvValue').textContent = `${number.format(ltv)}%`;
  $('#ltvBar').style.width = `${Math.min(Math.max(ltv, 0), 100)}%`;
  $('#ltvBar').style.background = ltv > 90 ? '#d96055' : '';
  $('#ltvWarning').hidden = loan <= deed;
}

function updateRateControls() {
  $('#euriborFieldset').classList.toggle('disabled', $('input[name="rateType"]:checked')?.value === 'fixed');
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, serializePersistentState(state));
  } catch (error) {
    console.warn('Não foi possível guardar a seleção.', error);
  }
}

function loadState() {
  try {
    const saved = parsePersistentState(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    state.selected = saved.selected;
    state.selectionContext = saved.selectionContext;
    state.scenarioConfig = saved.scenarioConfig;
  } catch (error) {
    console.warn('A seleção guardada não era válida.', error);
  }
}

function hydrateFormFromSelection() {
  if (!state.selectionContext) return;
  const context = state.selectionContext;
  $('#deedAmount').value = context.deedAmount;
  $('#loanAmount').value = context.loanAmount;
  $('#income').value = context.income;
  $('#loanTerm').value = context.loanTerm;
  updateLoanIndicators('loan');
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function switchView(view) {
  state.activeView = view === 'scenario' ? 'scenario' : 'offers';
  $$('[data-view]').forEach(button => {
    if (!button.matches('[role="tab"]')) return;
    const active = button.dataset.view === state.activeView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#offersView').hidden = state.activeView !== 'offers';
  $('#scenarioView').hidden = state.activeView !== 'scenario';
  if (state.activeView === 'scenario') {
    renderScenarioSelection();
    syncScenarioForm();
    renderScenario();
  }
  window.scrollTo({ top: Math.max(0, $('.view-tabs').offsetTop - 86), behavior: 'smooth' });
}

function clearSelection(showMessage = true) {
  state.selected = [];
  state.selectionContext = null;
  state.scenarioConfig = null;
  saveState();
  renderSelectionUI();
  renderProducts();
  if (showMessage) showToast('Seleção limpa.');
}

function initializeScenarioConfig(product) {
  if (state.scenarioConfig) return;
  const current = Number(product?.attributes?.euriborRate);
  const start = Number.isFinite(current) ? current : 2.5;
  state.scenarioConfig = {
    start,
    transitionYears: 5,
    horizonYears: Math.min(10, Number(state.selectionContext?.loanTerm) || 40),
    targets: { best: Math.max(0, start - 1.5), base: start, worst: start + 2 }
  };
}

function toggleSelection(product) {
  const next = toggleOfferSelection(state, product, state.params || getParams());
  if (next.status === 'full') return showToast(`Podes comparar no máximo ${MAX_SELECTION} propostas.`);
  if (next.status === 'incompatible') return showToast('Esta proposta pertence a uma simulação diferente. Limpa a seleção para continuar.');
  state.selected = next.selected;
  state.selectionContext = next.selectionContext;
  if (next.status === 'added') initializeScenarioConfig(product);
  if (!state.selected.length) state.scenarioConfig = null;
  saveState();
  renderSelectionUI();
  renderProducts();
  if (state.activeView === 'scenario') renderScenario();
}

function renderSelectionUI() {
  const count = state.selected.length;
  $('#tabSelectionCount').textContent = count;
  $('#selectionCount').textContent = count;
  $('#selectionBar').hidden = count === 0;
  $('#selectionChips').innerHTML = state.selected.map(item => `<span>${escapeHtml(bankName(item.product))} · ${escapeHtml(RATE_NAMES[rateType(item.product)] || 'Taxa')}</span>`).join('');
  renderScenarioSelection();
}

function renderScenarioSelection() {
  const count = state.selected.length;
  $('#scenarioEmpty').hidden = count >= 2;
  $('#scenarioApp').hidden = count < 2;
  $('#scenarioOffers').innerHTML = state.selected.map((item, index) => `
    <span class="scenario-offer-chip" style="--offer-color:${OFFER_COLORS[index]}"><i></i>${escapeHtml(bankName(item.product))}<button type="button" data-remove-key="${escapeHtml(item.key)}" aria-label="Remover ${escapeHtml(bankName(item.product))}">×</button></span>
  `).join('');
}

function showLoading() {
  $('#loadingState').hidden = false;
  $('#errorState').hidden = true;
  $('#summaryStrip').hidden = true;
  $('#offers').replaceChildren();
  $('#simulateButton').disabled = true;
  $('#apiStatus').className = 'api-status';
  $('#heroCount').textContent = '—';
}

function showError(error) {
  $('#loadingState').hidden = true;
  $('#summaryStrip').hidden = true;
  $('#errorState').hidden = false;
  $('#errorMessage').textContent = error.message || 'Confirma a ligação à internet e tenta novamente.';
  $('#simulateButton').disabled = false;
  $('#apiStatus').className = 'api-status offline';
}

async function fetchProducts(params = getParams()) {
  if (!paramsAreValid(params)) {
    showToast('Revê os valores do imóvel, financiamento, rendimento e prazo.');
    return;
  }
  if (state.requestController) state.requestController.abort();
  state.requestController = new AbortController();
  state.params = params;
  showLoading();
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  try {
    const response = await fetch(`${API_URL}?${query}`, { signal: state.requestController.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`A API respondeu com o estado ${response.status}.`);
    const payload = await response.json();
    const combined = [...(payload.sponsoredProducts || []), ...(payload.rankingProducts || [])];
    const unique = new Map(combined.map(product => [offerKey(product), product]));
    state.products = [...unique.values()];
    if (!state.products.length) throw new Error('Não foram encontradas propostas para estes critérios.');

    if (contextsMatch(state.selectionContext, coreContext(params))) {
      state.selected = state.selected.map(item => ({ ...item, product: unique.get(item.key) || item.product }));
      saveState();
    }
    $('#apiStatus').className = 'api-status online';
    $('#simulateButton').disabled = false;
    $('#loadingState').hidden = true;
    renderProducts();
    renderSelectionUI();
  } catch (error) {
    if (error.name !== 'AbortError') showError(error);
  }
}

function sortedProducts() {
  const key = $('#sortBy').value;
  return [...state.products].sort((left, right) => Number(left.attributes?.[key] ?? Infinity) - Number(right.attributes?.[key] ?? Infinity));
}

function renderSummary(products) {
  const attributes = products.map(product => product.attributes || {});
  const lowestInstallment = Math.min(...attributes.map(item => Number(item.installment) || Infinity));
  $('#bestInstallment').textContent = eur.format(lowestInstallment);
  $('#summaryStrip').hidden = false;
  $('#heroCount').textContent = products.length;
}

function renderProducts() {
  const container = $('#offers');
  const products = sortedProducts();
  container.replaceChildren();
  if (!products.length || !state.params) return;
  renderSummary(products);
  products.forEach((product, index) => container.append(renderOffer(product, index)));
}

function rateDescription(attributes) {
  const type = String(attributes.rateType || '').toLowerCase();
  if (type === 'mixed') return `${attributes.loanMixedRateFixedTenure || '—'} ano(s) fixos`;
  if (type === 'variable') return `revisão ${EURIBOR_NAMES[String(attributes.euriborType || '').toLowerCase()] || ''}`;
  return 'durante todo o prazo';
}

function currentSchedule(product) {
  const current = Number(product.attributes?.euriborRate) || 0;
  const result = simulateOffer(product, state.params, { start: current, target: current, transitionYears: 1 }, Number(product.attributes?.loanTerm || state.params.loanTerm * 12) / 12);
  return { ...result, rows: aggregateYears(result.months) };
}

function renderOffer(product, index) {
  const fragment = $('#offerTemplate').content.cloneNode(true);
  const card = $('.offer-card', fragment);
  const attributes = product.attributes || {};
  const key = offerKey(product);
  const selected = state.selected.some(item => item.key === key);
  const effort = Number(attributes.installment) / state.params.income * 100;
  const schedule = currentSchedule(product);
  card.dataset.offerKey = key;
  card.classList.toggle('selected', selected);
  card.style.animationDelay = `${Math.min(index * 35, 280)}ms`;
  $('.rank-badge', card).textContent = index + 1;
  const logo = $('.bank-logo', card);
  logo.src = product.imageUrl || '';
  logo.alt = `Logótipo ${bankName(product)}`;
  logo.addEventListener('error', () => { logo.closest('.bank-logo-wrap').style.display = 'none'; });
  $('.product-label', card).textContent = index === 0 ? 'MELHOR NESTA ORDENAÇÃO' : 'PROPOSTA BANCÁRIA';
  $('.bank-name', card).textContent = bankName(product);
  $('.rate-type', card).textContent = RATE_NAMES[rateType(product)] || 'Taxa';
  $('.rate-tenure', card).textContent = rateDescription(attributes);
  $('.installment', card).textContent = eur.format(attributes.installment);
  $('.effort', card).textContent = `taxa de esforço ${formatRate(effort)}`;
  $('.taeg', card).textContent = formatRate(attributes.taeg);
  $('.mtic', card).textContent = eur.format(attributes.mtic);
  $('.total-cost', card).textContent = `${eur.format((attributes.mtic || 0) - state.params.loanAmount)} acima do capital`;
  $('.spread', card).textContent = formatRate(attributes.spread);
  $('.euribor-detail', card).textContent = rateType(product) === 'fixed' ? 'não aplicável' : `Euribor ${formatRate(attributes.euriborRate)}`;
  $('.tan', card).textContent = formatRate(offerTan(product));
  $('.rate-detail', card).textContent = rateDescription(attributes);
  $('.initial-cost', card).textContent = eur.format(attributes.totalComission || 0);
  $('.product-id', card).textContent = product.productId || product.bankId || '';

  const compareButton = $('.compare-button', card);
  compareButton.classList.toggle('active', selected);
  compareButton.setAttribute('aria-pressed', String(selected));
  $('.compare-check', compareButton).textContent = selected ? '✓' : '+';
  $('.compare-label', compareButton).textContent = selected ? 'Selecionada' : 'Comparar';
  compareButton.disabled = !selected && state.selected.length >= MAX_SELECTION;
  compareButton.addEventListener('click', () => toggleSelection(product));

  renderPhases($('.loan-phases', card), product, schedule);
  renderCommissions($('.commission-list', card), attributes);
  renderConditions($('.conditions-list', card), product.features || []);
  renderSchedule($('.schedule-body', card), schedule.rows);
  $('.calculation-note', card).textContent = scheduleNote(product, schedule);
  $('.details-button', card).addEventListener('click', () => setOfferDetail(card, $('.offer-details', card).hidden));
  $('.schedule-toggle', card).addEventListener('click', () => {
    const content = $('.schedule-content', card);
    const open = content.hidden;
    content.hidden = !open;
    const button = $('.schedule-toggle', card);
    button.setAttribute('aria-expanded', String(open));
    $('span', button).textContent = open ? 'Ocultar amortização' : 'Ver amortização';
  });
  return fragment;
}

function setOfferDetail(card, open) {
  $$('.offer-card').forEach(item => {
    const shouldOpen = item === card && open;
    $('.offer-details', item).hidden = !shouldOpen;
    const button = $('.details-button', item);
    button.setAttribute('aria-expanded', String(shouldOpen));
    $('span', button).textContent = shouldOpen ? 'Fechar detalhe' : 'Ver detalhe';
  });
  state.openOfferKey = open ? card.dataset.offerKey : null;
}

function renderPhases(container, product, schedule) {
  const attributes = product.attributes || {};
  const type = rateType(product);
  const totalMonths = Number(attributes.loanTerm) || state.params.loanTerm * 12;
  const phases = [];
  if (type === 'mixed') {
    phases.push({ title: 'Período inicial fixo', subtitle: `${schedule.fixedMonths / 12} ano(s) · TAN ${formatRate(offerTan(product))}`, payment: attributes.installment });
    phases.push({ title: 'Período variável estimado', subtitle: `${(totalMonths - schedule.fixedMonths) / 12} ano(s) · Euribor ${formatRate(attributes.euriborRate)} + spread ${formatRate(attributes.spread)}`, payment: schedule.months[schedule.fixedMonths]?.payment, estimate: true });
  } else {
    phases.push({ title: type === 'fixed' ? 'Taxa fixa' : 'Taxa variável', subtitle: `${totalMonths / 12} ano(s) · TAN ${formatRate(offerTan(product))}`, payment: attributes.installment });
  }
  phases.forEach((phase, index) => {
    const row = document.createElement('div');
    row.className = 'phase';
    row.innerHTML = `<span class="phase-number">0${index + 1}</span><div><b>${escapeHtml(phase.title)}</b><span>${escapeHtml(phase.subtitle)}</span></div><strong>${eur.format(phase.payment || 0)}<small>${phase.estimate ? 'estimativa/mês' : 'por mês'}</small></strong>`;
    container.append(row);
  });
}

function renderCommissions(container, attributes) {
  [['Avaliação do imóvel', attributes.evaluationCommission], ['Formalização', attributes.formalizationCommission], ['Dossier / processo', attributes.dossierCommission]].forEach(([label, value]) => {
    const row = document.createElement('div');
    row.innerHTML = `<dt>${label}</dt><dd>${eur.format(value || 0)}</dd>`;
    container.append(row);
  });
  const total = document.createElement('div');
  total.innerHTML = `<dt>Total de comissões</dt><dd>${eur.format(attributes.totalComission || 0)}</dd>`;
  container.append(total);
}

function renderConditions(container, features) {
  features.forEach(feature => {
    const item = document.createElement('div');
    item.className = 'condition-item';
    item.innerHTML = `<div class="condition-title"><span class="condition-check">✓</span><b>${escapeHtml(feature.title)}</b></div><p>${escapeHtml(feature.description)}</p>`;
    container.append(item);
  });
}

function renderSchedule(container, rows) {
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.year}</td><td>${eur.format(row.payment)}</td><td>${eur.format(row.principal)}</td><td>${eur.format(row.interest)}</td><td>${eur.format(row.balance)}</td>`;
    container.append(tr);
  });
}

function scheduleNote(product) {
  const attributes = product.attributes || {};
  if (rateType(product) === 'mixed') return `A fase variável mantém a Euribor atual (${formatRate(attributes.euriborRate)}) e o spread (${formatRate(attributes.spread)}) constantes. Usa o Simulador para testar outras trajetórias.`;
  if (rateType(product) === 'variable') return `Estimativa mantendo a Euribor atual. A prestação real será revista a cada ${EURIBOR_NAMES[String(attributes.euriborType || '').toLowerCase()] || 'período contratual'}.`;
  return 'Estimativa pela fórmula de prestações constantes, sem seguros nem comissões incorporadas no capital.';
}

function scenarioConfigFromForm() {
  return {
    start: Number($('#scenarioStart').value),
    transitionYears: Number($('#transitionYears').value),
    horizonYears: Number($('#horizonYears').value),
    targets: { best: Number($('#targetBest').value), base: Number($('#targetBase').value), worst: Number($('#targetWorst').value) }
  };
}

function syncScenarioForm() {
  if (!state.scenarioConfig) return;
  $('#scenarioStart').value = Number(state.scenarioConfig.start).toFixed(2);
  $('#transitionYears').value = state.scenarioConfig.transitionYears;
  $('#horizonYears').value = state.scenarioConfig.horizonYears;
  $('#targetBest').value = Number(state.scenarioConfig.targets.best).toFixed(2);
  $('#targetBase').value = Number(state.scenarioConfig.targets.base).toFixed(2);
  $('#targetWorst').value = Number(state.scenarioConfig.targets.worst).toFixed(2);
}

function maxScenarioYears() {
  return Math.min(...state.selected.map(item => Number(item.product.attributes?.loanTerm || item.context.loanTerm * 12) / 12));
}

function computeScenarioResults() {
  const output = {};
  SCENARIO_ORDER.forEach(name => {
    const scenario = { start: state.scenarioConfig.start, target: state.scenarioConfig.targets[name], transitionYears: state.scenarioConfig.transitionYears };
    output[name] = state.selected.map((item, index) => ({
      item,
      index,
      result: simulateOffer(item.product, item.context, scenario, state.scenarioConfig.horizonYears)
    }));
  });
  return output;
}

function renderScenario() {
  if (state.selected.length < 2 || !state.scenarioConfig) return;
  const maxYears = maxScenarioYears();
  $('#horizonYears').max = maxYears;
  const errors = validateScenarioConfig(state.scenarioConfig, maxYears);
  $('#scenarioError').hidden = errors.length === 0;
  $('#scenarioError').innerHTML = errors.map(error => `<div>• ${escapeHtml(error)}</div>`).join('');
  if (errors.length) {
    state.scenarioResults = null;
    $('#euriborChart').replaceChildren();
    $('#paymentChart').replaceChildren();
    $('#comparisonBody').replaceChildren();
    $('#breakdownGrid').replaceChildren();
    return;
  }
  const results = computeScenarioResults();
  state.scenarioResults = results;
  renderEuriborChart();
  renderPaymentChart(results[state.chartScenario]);
  renderMatrix(results);
  renderBreakdown(results[state.chartScenario]);
  saveState();
}

function renderEuriborChart() {
  const horizon = state.scenarioConfig.horizonYears;
  const series = SCENARIO_ORDER.map(name => ({
    name: SCENARIO_NAMES[name],
    color: SCENARIO_COLORS[name],
    points: Array.from({ length: Math.round(horizon * 12) + 1 }, (_, month) => ({ x: month / 12, y: euriborAtMonth({ start: state.scenarioConfig.start, target: state.scenarioConfig.targets[name], transitionYears: state.scenarioConfig.transitionYears }, month) }))
  }));
  drawChart($('#euriborChart'), series, horizon, value => `${number.format(value)}%`, false);
}

function renderPaymentChart(results) {
  const series = results.map(({ item, result, index }) => ({
    name: bankName(item.product),
    color: OFFER_COLORS[index],
    points: result.months.map(month => ({ x: month.month / 12, y: month.payment }))
  }));
  $('#offerLegend').innerHTML = series.map(item => `<span style="--offer-color:${item.color}">${escapeHtml(item.name)}</span>`).join('');
  drawChart($('#paymentChart'), series, state.scenarioConfig.horizonYears, value => eur.format(value), true);
}

function drawChart(svg, series, maxX, valueFormatter, positiveOnly) {
  const width = 900;
  const height = svg.id === 'paymentChart' ? 310 : 280;
  const margin = { top: 18, right: 24, bottom: 36, left: 68 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = series.flatMap(item => item.points.map(point => point.y)).filter(Number.isFinite);
  let minY = Math.min(...values);
  let maxY = Math.max(...values);
  const padding = Math.max((maxY - minY) * .14, positiveOnly ? 25 : .25);
  minY = positiveOnly ? Math.max(0, minY - padding) : minY - padding;
  maxY += padding;
  if (maxY === minY) maxY = minY + 1;
  const x = value => margin.left + (value / Math.max(maxX, .01)) * plotWidth;
  const y = value => margin.top + (1 - (value - minY) / (maxY - minY)) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => minY + ((maxY - minY) * index) / 4);
  const xTicks = Array.from({ length: 6 }, (_, index) => (maxX * index) / 5);
  let markup = '';
  yTicks.forEach(value => {
    const cy = y(value);
    markup += `<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${cy}" y2="${cy}"/><text class="axis-label" x="${margin.left - 10}" y="${cy + 4}" text-anchor="end">${escapeHtml(valueFormatter(value))}</text>`;
  });
  xTicks.forEach(value => {
    const cx = x(value);
    markup += `<line class="grid-line" x1="${cx}" x2="${cx}" y1="${margin.top}" y2="${height - margin.bottom}"/><text class="axis-label" x="${cx}" y="${height - 12}" text-anchor="middle">${number.format(value)}a</text>`;
  });
  series.forEach(item => {
    const path = item.points.map((point, index) => `${index ? 'L' : 'M'}${x(point.x).toFixed(2)},${y(point.y).toFixed(2)}`).join(' ');
    markup += `<path class="chart-path" d="${path}" stroke="${item.color}"/>`;
    item.points.filter((point, index) => index === item.points.length - 1 || index % 12 === 0).forEach(point => {
      markup += `<circle class="chart-point" cx="${x(point.x)}" cy="${y(point.y)}" r="4" fill="${item.color}"><title>${escapeHtml(item.name)} · ${number.format(point.x)} anos · ${escapeHtml(valueFormatter(point.y))}</title></circle>`;
    });
  });
  svg.innerHTML = markup;
}

function renderMatrix(results) {
  $('#matrixHorizon').textContent = number.format(state.scenarioConfig.horizonYears);
  const winners = Object.fromEntries(SCENARIO_ORDER.map(name => [name, Math.min(...results[name].map(entry => entry.result.comparableCost))]));
  $('#comparisonBody').innerHTML = state.selected.map((item, offerIndex) => {
    const cells = SCENARIO_ORDER.map(name => {
      const result = results[name][offerIndex].result;
      const winner = Math.abs(result.comparableCost - winners[name]) < .01;
      return `<td class="matrix-cell">${winner ? '<span class="winner-badge">MELHOR</span>' : ''}<span class="matrix-value">${eur.format(result.comparableCost)}</span><small>${eur.format(result.installmentTotal)} em prestações</small><small>${eur.format(result.balance)} ainda em dívida</small></td>`;
    }).join('');
    return `<tr><td><span class="matrix-bank" style="--offer-color:${OFFER_COLORS[offerIndex]}"><i></i>${escapeHtml(bankName(item.product))}<small>${escapeHtml(RATE_NAMES[rateType(item.product)] || '')}</small></span></td>${cells}</tr>`;
  }).join('');
}

function renderBreakdown(results) {
  $('#breakdownScenario').textContent = SCENARIO_NAMES[state.chartScenario];
  $('#breakdownGrid').innerHTML = results.map(({ item, result, index }) => `
    <article class="analysis-card" style="--offer-color:${OFFER_COLORS[index]}">
      <div class="analysis-head"><div><h4>${escapeHtml(bankName(item.product))}</h4><span>${escapeHtml(RATE_NAMES[rateType(item.product)] || '')}</span></div><span>${result.type === 'fixed' ? 'Não depende da Euribor' : `Revisão ${result.cadence}m`}</span></div>
      <div class="analysis-primary"><small>Total pago em prestações</small><strong>${eur.format(result.installmentTotal)}</strong></div>
      <div class="analysis-metrics">
        <div><span>Saldo em dívida</span><b>${eur.format(result.balance)}</b></div><div><span>Juros pagos</span><b>${eur.format(result.interestTotal)}</b></div>
        <div><span>Capital amortizado</span><b>${eur.format(result.principalTotal)}</b></div><div><span>Comissões</span><b>${eur.format(result.commissions)}</b></div>
        <div><span>Prestação em Y</span><b>${eur.format(result.currentPayment)}</b></div><div><span>Prestação máxima</span><b>${eur.format(result.maxPayment)}</b></div>
      </div>
    </article>
  `).join('');
}

$('#simulationForm').addEventListener('submit', event => {
  event.preventDefault();
  const params = getParams();
  if (state.selected.length && !contextsMatch(state.selectionContext, coreContext(params))) {
    const proceed = window.confirm('Alterar os valores-base vai limpar as propostas selecionadas. Queres continuar?');
    if (!proceed) return;
    clearSelection(false);
  }
  fetchProducts(params);
});
$('#sortBy').addEventListener('change', renderProducts);
$('#retryButton').addEventListener('click', () => fetchProducts(state.params || getParams()));
$('#deedAmount').addEventListener('input', () => updateLoanIndicators('deed'));
$('#initialCapital').addEventListener('input', () => updateLoanIndicators('capital'));
$('#loanAmount').addEventListener('input', () => updateLoanIndicators('loan'));
$$('input[name="rateType"]').forEach(input => input.addEventListener('change', updateRateControls));
$('#clearSelection').addEventListener('click', () => clearSelection());
$('#openSimulator').addEventListener('click', () => {
  if (state.selected.length < 2) showToast('Seleciona pelo menos duas propostas para comparar.');
  switchView('scenario');
});
$$('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#scenarioOffers').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-key]');
  if (!button) return;
  const selected = state.selected.find(item => item.key === button.dataset.removeKey);
  if (selected) toggleSelection(selected.product);
});
$$('[data-chart-scenario]').forEach(button => button.addEventListener('click', () => {
  state.chartScenario = button.dataset.chartScenario;
  $$('[data-chart-scenario]').forEach(item => item.classList.toggle('active', item === button));
  renderScenario();
}));
$('#scenarioForm').addEventListener('input', () => {
  state.scenarioConfig = scenarioConfigFromForm();
  renderScenario();
});

loadState();
hydrateFormFromSelection();
updateLoanIndicators('loan');
updateRateControls();
renderSelectionUI();
if (state.scenarioConfig) syncScenarioForm();
fetchProducts();
