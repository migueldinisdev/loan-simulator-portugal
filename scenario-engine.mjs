export const SCENARIO_ORDER = ['best', 'base', 'worst'];

export function monthlyPayment(principal, annualRate, months) {
  const capital = Number(principal);
  const periods = Math.max(0, Math.round(Number(months)));
  const rate = Math.max(0, Number(annualRate)) / 100 / 12;
  if (!periods || capital <= 0) return 0;
  if (!rate) return capital / periods;
  return capital * rate / (1 - Math.pow(1 + rate, -periods));
}

export function euriborAtMonth({ start, target, transitionYears }, elapsedMonth) {
  const from = Number(start) || 0;
  const to = Number(target) || 0;
  const transitionMonths = Math.max(1, Number(transitionYears) * 12);
  const progress = Math.min(Math.max(Number(elapsedMonth) || 0, 0) / transitionMonths, 1);
  return from + (to - from) * progress;
}

export function reviewCadence(euriborType) {
  const normalized = String(euriborType || '').toLowerCase();
  if (normalized.includes('three') || normalized === '3') return 3;
  if (normalized.includes('twelve') || normalized === '12') return 12;
  return 6;
}

export function offerKey(product) {
  const attributes = product?.attributes || {};
  return [
    product?.productId || product?.bankId || 'produto',
    String(attributes.rateType || '').toLowerCase(),
    attributes.loanMixedRateFixedTenure || 0,
    attributes.euriborType || ''
  ].join('|');
}

export function offerTan(product) {
  const attributes = product?.attributes || {};
  const type = String(attributes.rateType || '').toLowerCase();
  if (type === 'mixed') return Number(attributes.mixedTan) || 0;
  if (type === 'fixed') return Number(attributes.fixedTan ?? attributes.mixedTan) || 0;
  return Math.max(0, Number(attributes.euriborRate || 0) + Number(attributes.spread || 0));
}

export function simulateOffer(product, context, scenario, horizonYears) {
  const attributes = product?.attributes || {};
  const type = String(attributes.rateType || context?.rateType || 'variable').toLowerCase();
  const totalMonths = Math.max(1, Math.round(Number(attributes.loanTerm) || Number(context?.loanTerm) * 12));
  const horizonMonths = Math.min(totalMonths, Math.max(1, Math.round(Number(horizonYears) * 12)));
  const fixedMonths = type === 'mixed'
    ? Math.min(Math.round(Number(attributes.loanMixedRateFixedTenure || 0) * 12), totalMonths)
    : type === 'fixed' ? totalMonths : 0;
  const cadence = reviewCadence(attributes.euriborType || context?.euriborType);
  const spread = Number(attributes.spread) || 0;
  const principalAmount = Number(context?.loanAmount) || 0;
  const fixedRate = Math.max(0, offerTan(product));
  const scenarioStart = Number(scenario?.start) || 0;

  let balance = principalAmount;
  let appliedRate = type === 'fixed' || type === 'mixed' ? fixedRate : Math.max(0, scenarioStart + spread);
  let payment = Number(attributes.installment) || monthlyPayment(balance, appliedRate, totalMonths);
  if (type === 'variable') payment = monthlyPayment(balance, appliedRate, totalMonths);

  let installmentTotal = 0;
  let interestTotal = 0;
  let principalTotal = 0;
  let maxPayment = 0;
  const months = [];

  for (let month = 1; month <= horizonMonths && balance > 0.005; month += 1) {
    const elapsedMonth = month - 1;
    const scenarioEuribor = euriborAtMonth(scenario, elapsedMonth);
    const remainingMonths = totalMonths - month + 1;

    if (type === 'variable' && month > 1 && elapsedMonth % cadence === 0) {
      appliedRate = Math.max(0, scenarioEuribor + spread);
      payment = monthlyPayment(balance, appliedRate, remainingMonths);
    }

    if (type === 'mixed' && month === fixedMonths + 1) {
      appliedRate = Math.max(0, scenarioEuribor + spread);
      payment = monthlyPayment(balance, appliedRate, remainingMonths);
    } else if (type === 'mixed' && month > fixedMonths + 1 && (month - fixedMonths - 1) % cadence === 0) {
      appliedRate = Math.max(0, scenarioEuribor + spread);
      payment = monthlyPayment(balance, appliedRate, remainingMonths);
    }

    const interest = balance * (appliedRate / 100 / 12);
    const principal = Math.min(Math.max(payment - interest, 0), balance);
    const actualPayment = principal + interest;
    balance = Math.max(0, balance - principal);
    installmentTotal += actualPayment;
    interestTotal += interest;
    principalTotal += principal;
    maxPayment = Math.max(maxPayment, actualPayment);
    months.push({ month, payment: actualPayment, interest, principal, balance, rate: appliedRate, euribor: scenarioEuribor });
  }

  const commissions = Number(attributes.totalComission) || 0;
  return {
    type,
    totalMonths,
    horizonMonths,
    fixedMonths,
    cadence,
    months,
    installmentTotal,
    interestTotal,
    principalTotal,
    balance,
    commissions,
    currentPayment: months.at(-1)?.payment || 0,
    maxPayment,
    comparableCost: installmentTotal + commissions + balance
  };
}

export function aggregateYears(months) {
  const rows = [];
  for (let offset = 0; offset < months.length; offset += 12) {
    const slice = months.slice(offset, offset + 12);
    if (!slice.length) break;
    rows.push({
      year: Math.floor(offset / 12) + 1,
      payment: slice.reduce((sum, item) => sum + item.payment, 0),
      principal: slice.reduce((sum, item) => sum + item.principal, 0),
      interest: slice.reduce((sum, item) => sum + item.interest, 0),
      balance: slice.at(-1).balance
    });
  }
  return rows;
}

export function validateScenarioConfig(config, maxYears) {
  const errors = [];
  const start = Number(config.start);
  const best = Number(config.targets?.best);
  const base = Number(config.targets?.base);
  const worst = Number(config.targets?.worst);
  const transitionYears = Number(config.transitionYears);
  const horizonYears = Number(config.horizonYears);
  if (![start, best, base, worst].every(Number.isFinite)) errors.push('Preenche todos os valores da Euribor.');
  if (best > base || base > worst) errors.push('Os alvos devem respeitar Best ≤ Base ≤ Worst.');
  if (!(transitionYears > 0)) errors.push('A progressão X deve ser superior a zero.');
  if (!(horizonYears > 0)) errors.push('O horizonte Y deve ser superior a zero.');
  if (Number.isFinite(maxYears) && horizonYears > maxYears) errors.push(`O horizonte Y não pode exceder ${maxYears} anos.`);
  return errors;
}
