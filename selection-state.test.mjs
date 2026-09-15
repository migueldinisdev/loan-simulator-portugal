import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SELECTION,
  contextsMatch,
  parsePersistentState,
  serializePersistentState,
  toggleOfferSelection
} from './selection-state.mjs';

const context = { deedAmount: 190000, loanAmount: 170000, income: 2500, loanTerm: 35 };
const offer = index => ({
  productId: `BANK${index}`,
  attributes: { rateType: index % 2 ? 'mixed' : 'variable', loanMixedRateFixedTenure: index, euriborType: 'sixMonth' }
});

test('seleciona e remove a mesma proposta', () => {
  const added = toggleOfferSelection({ selected: [], selectionContext: null }, offer(1), context);
  assert.equal(added.status, 'added');
  assert.equal(added.selected.length, 1);
  const removed = toggleOfferSelection(added, offer(1), context);
  assert.equal(removed.status, 'removed');
  assert.equal(removed.selected.length, 0);
  assert.equal(removed.selectionContext, null);
});

test('limita a seleção a quatro propostas', () => {
  let current = { selected: [], selectionContext: null };
  for (let index = 1; index <= MAX_SELECTION; index += 1) {
    current = toggleOfferSelection(current, offer(index), context);
  }
  const rejected = toggleOfferSelection(current, offer(5), context);
  assert.equal(rejected.status, 'full');
  assert.equal(rejected.selected.length, MAX_SELECTION);
});

test('recusa propostas de uma simulação-base incompatível', () => {
  const selected = toggleOfferSelection({ selected: [], selectionContext: null }, offer(1), context);
  const rejected = toggleOfferSelection(selected, offer(2), { ...context, loanAmount: 165000 });
  assert.equal(rejected.status, 'incompatible');
  assert.equal(rejected.selected.length, 1);
  assert.ok(contextsMatch(rejected.selectionContext, context));
});

test('serializa e restaura o esquema versionado', () => {
  let current = toggleOfferSelection({ selected: [], selectionContext: null }, offer(1), context);
  current = { ...current, scenarioConfig: { start: 2.7, transitionYears: 5, horizonYears: 10 } };
  const restored = parsePersistentState(serializePersistentState(current));
  assert.equal(restored.selected.length, 1);
  assert.deepEqual(restored.selectionContext, context);
  assert.equal(restored.scenarioConfig.horizonYears, 10);
  assert.equal(parsePersistentState(JSON.stringify({ version: 1 })), null);
});
