import { offerKey } from './scenario-engine.mjs';

export const STORAGE_VERSION = 2;
export const MAX_SELECTION = 4;

export function coreContext(params = {}) {
  return {
    deedAmount: Number(params.deedAmount),
    loanAmount: Number(params.loanAmount),
    income: Number(params.income),
    loanTerm: Number(params.loanTerm)
  };
}

export function contextsMatch(left, right) {
  if (!left || !right) return false;
  return ['deedAmount', 'loanAmount', 'income', 'loanTerm']
    .every(key => Math.abs(Number(left[key]) - Number(right[key])) < 0.001);
}

export function toggleOfferSelection(current, product, params, maximum = MAX_SELECTION) {
  const selected = Array.isArray(current?.selected) ? [...current.selected] : [];
  const key = offerKey(product);
  const existingIndex = selected.findIndex(item => item.key === key);

  if (existingIndex >= 0) {
    selected.splice(existingIndex, 1);
    return {
      status: 'removed',
      selected,
      selectionContext: selected.length ? current.selectionContext : null
    };
  }

  if (selected.length >= maximum) {
    return { status: 'full', selected, selectionContext: current?.selectionContext || null };
  }

  const context = coreContext(params);
  if (current?.selectionContext && !contextsMatch(current.selectionContext, context)) {
    return { status: 'incompatible', selected, selectionContext: current.selectionContext };
  }

  selected.push({ key, product, context });
  return {
    status: 'added',
    selected,
    selectionContext: current?.selectionContext || context
  };
}

export function serializePersistentState(state) {
  return JSON.stringify({
    version: STORAGE_VERSION,
    selected: state.selected,
    selectionContext: state.selectionContext,
    scenarioConfig: state.scenarioConfig
  });
}

export function parsePersistentState(raw, maximum = MAX_SELECTION) {
  const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (saved?.version !== STORAGE_VERSION) return null;
  const selected = Array.isArray(saved.selected)
    ? saved.selected.filter(item => item?.product?.attributes).slice(0, maximum)
    : [];
  return {
    selected,
    selectionContext: saved.selectionContext || selected[0]?.context || null,
    scenarioConfig: saved.scenarioConfig || null
  };
}
