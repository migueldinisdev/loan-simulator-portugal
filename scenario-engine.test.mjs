import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateYears,
  euriborAtMonth,
  monthlyPayment,
  reviewCadence,
  simulateOffer,
  validateScenarioConfig
} from './scenario-engine.mjs';

const context = { loanAmount: 190000, loanTerm: 40, euriborType: 'sixMonth', rateType: 'mixed' };
const scenario = { start: 2.5, target: 4.5, transitionYears: 5 };
const product = (rateType, overrides = {}) => ({
  productId: `TEST-${rateType}`,
  attributes: {
    rateType,
    loanTerm: 480,
    loanMixedRateFixedTenure: 2,
    euriborType: 'SixMonth',
    euriborRate: 2.5,
    spread: 0.8,
    mixedTan: 2.65,
    fixedTan: 3.2,
    installment: monthlyPayment(190000, rateType === 'fixed' ? 3.2 : rateType === 'mixed' ? 2.65 : 3.3, 480),
    totalComission: 700,
    ...overrides
  }
});

test('calcula prestação sem juros e com juros', () => {
  assert.equal(monthlyPayment(1200, 0, 12), 100);
  assert.ok(monthlyPayment(190000, 3, 480) > 600);
});

test('interpola a Euribor e mantém o alvo depois de X', () => {
  assert.equal(euriborAtMonth(scenario, 0), 2.5);
  assert.equal(euriborAtMonth(scenario, 30), 3.5);
  assert.equal(euriborAtMonth(scenario, 120), 4.5);
});

test('normaliza periodicidades de revisão', () => {
  assert.equal(reviewCadence('ThreeMonth'), 3);
  assert.equal(reviewCadence('SixMonth'), 6);
  assert.equal(reviewCadence('TwelveMonth'), 12);
});

test('taxa fixa produz o mesmo resultado em cenários diferentes', () => {
  const fixed = product('Fixed');
  const low = simulateOffer(fixed, context, { start: 0, target: 0, transitionYears: 5 }, 10);
  const high = simulateOffer(fixed, context, { start: 5, target: 8, transitionYears: 5 }, 10);
  assert.equal(low.installmentTotal, high.installmentTotal);
  assert.equal(low.balance, high.balance);
});

test('taxa variável revê a prestação na periodicidade contratual', () => {
  const result = simulateOffer(product('Variable', { installment: 1 }), { ...context, rateType: 'variable' }, scenario, 2);
  assert.ok(result.months[0].payment > 600);
  assert.equal(result.months[0].payment, result.months[5].payment);
  assert.notEqual(result.months[5].payment, result.months[6].payment);
});

for (const [euriborType, cadence] of [['ThreeMonth', 3], ['SixMonth', 6], ['TwelveMonth', 12]]) {
  test(`aplica revisões de ${cadence} meses`, () => {
    const result = simulateOffer(product('Variable', { euriborType }), { ...context, rateType: 'variable' }, scenario, 2);
    assert.equal(result.months[0].payment, result.months[cadence - 1].payment);
    assert.notEqual(result.months[cadence - 1].payment, result.months[cadence].payment);
  });
}

test('taxa mista preserva a prestação fixa e muda após o período inicial', () => {
  const result = simulateOffer(product('Mixed'), context, scenario, 5);
  assert.equal(result.months[0].payment, result.months[23].payment);
  assert.notEqual(result.months[23].payment, result.months[24].payment);
});

test('totais mensais fecham e o empréstimo termina sem saldo', () => {
  const result = simulateOffer(product('Variable'), { ...context, rateType: 'variable' }, { start: 2.5, target: 2.5, transitionYears: 5 }, 40);
  assert.ok(Math.abs(result.installmentTotal - result.interestTotal - result.principalTotal) < 0.01);
  assert.ok(result.balance < 0.01);
  assert.equal(aggregateYears(result.months).length, 40);
});

test('trata X inferior e superior ao horizonte Y', () => {
  const shortCurve = simulateOffer(product('Variable'), { ...context, rateType: 'variable' }, { start: 2.5, target: 5, transitionYears: 2 }, 5);
  const longCurve = simulateOffer(product('Variable'), { ...context, rateType: 'variable' }, { start: 2.5, target: 5, transitionYears: 10 }, 5);
  assert.equal(shortCurve.months.at(-1).euribor, 5);
  assert.ok(longCurve.months.at(-1).euribor < 5);
  assert.ok(longCurve.months.at(-1).euribor > 2.5);
});

test('valida ordenação dos cenários e horizonte', () => {
  assert.equal(validateScenarioConfig({ start: 2, targets: { best: 1, base: 2, worst: 4 }, transitionYears: 5, horizonYears: 10 }, 40).length, 0);
  assert.equal(validateScenarioConfig({ start: 2, targets: { best: 3, base: 2, worst: 1 }, transitionYears: 0, horizonYears: 50 }, 40).length, 3);
});
