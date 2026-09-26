'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../founder/engine.js');

function input(overrides = {}) {
  const base = {
    asOf: '2026-09-14', period: { start: '2026-09-07', end: '2026-09-13', label: 'Minulý týden', partial: false },
    completedPaidJobs: 40, team: { independent: false, crews: 1, locations: 1, national: false },
    metrics: {
      qualifiedLeads: 20, quotesSent: 20, wonQuotes: 8, jobsWon: 8, completedJobs: 8,
      revenue: 200000, directCosts: 120000, actualHours: 160,
      availableHours: 200, soldHours: 150, futureBookedHours: 64, dailyAvailableHours: 16,
      estimatedDirectCosts: 120000, consecutiveLosses: 0, lostTiming: 0, lostCount: 5,
      lateStartRate: 0, reworkRate: 0, founderDelegatableHours: 10, founderHours: 40, understaffed: 0
    },
    cash: { asOf: '2026-09-14', bankCash: 600000, taxReserve: 50000, payrollReserve: 40000, committedPayables: 20000, customerAdvanceReserve: 30000, weeklyBurn: 20000, overdueLiabilities: 0, unfundedWork: false },
    dataIssues: []
  };
  return { ...base, ...overrides, metrics: { ...base.metrics, ...overrides.metrics }, cash: { ...base.cash, ...overrides.cash }, team: { ...base.team, ...overrides.team } };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} should equal ${expected}`);

test('calculates gross margin, labor days, conversions, utilization, backlog and variance', () => {
  const state = Engine.analyze(input());
  assert.equal(state.metrics.grossProfit, 80000);
  near(state.metrics.grossMargin, 0.4);
  assert.equal(state.metrics.crewDays, 20);
  assert.equal(state.metrics.gpPerCrewDay, 4000);
  assert.equal(state.metrics.revenuePerCrewDay, 10000);
  assert.equal(state.metrics.quoteWinRate, 0.4);
  assert.equal(state.metrics.leadWinRate, 0.4);
  assert.equal(state.metrics.leadQuoteRate, 1);
  assert.equal(state.metrics.utilization, 0.75);
  assert.equal(state.metrics.backlogDays, 4);
  assert.equal(state.metrics.costVariance, 0);
  assert.equal(state.metrics.averageTicket, 25000);
});

test('cash reserves are deducted exactly once and payroll is not deducted twice in survival runway', () => {
  const cash = Engine.analyze(input()).cash;
  assert.equal(cash.reservedCash, 190000);
  assert.equal(cash.freeCash, 410000);
  assert.equal(cash.survivalCash, 500000);
  assert.equal(cash.runway, 25);
  assert.equal(cash.status, 'HEALTHY');
});

test('A: few leads + available capacity + healthy economics and conversion -> DEMAND', () => {
  const state = Engine.analyze(input({ metrics: { qualifiedLeads: 8, quotesSent: 8, wonQuotes: 3, jobsWon: 3, soldHours: 80, futureBookedHours: 32 } }));
  assert.equal(state.primary.key, 'DEMAND');
  assert.equal(state.primary.score, 88);
});

test('B: plentiful leads + low close rate + available capacity -> CONVERSION', () => {
  const state = Engine.analyze(input({ metrics: { qualifiedLeads: 40, quotesSent: 30, wonQuotes: 3, jobsWon: 3, soldHours: 80, futureBookedHours: 32 } }));
  assert.equal(state.primary.key, 'CONVERSION');
});

test('C: full capacity + long backlog -> CAPACITY', () => {
  const state = Engine.analyze(input({ metrics: { soldHours: 190, futureBookedHours: 288, lostTiming: 4, lostCount: 8 } }));
  assert.equal(state.primary.key, 'CAPACITY');
  assert.equal(state.metrics.backlogDays, 18);
});

test('D: good sales + poor gross margin -> ECONOMICS', () => {
  const state = Engine.analyze(input({ metrics: { directCosts: 190000, soldHours: 190, futureBookedHours: 288 } }));
  assert.equal(state.primary.key, 'ECONOMICS');
});

test('E: all operational areas functional + critical runway -> CASH', () => {
  const state = Engine.analyze(input({ cash: { bankCash: 230000, weeklyBurn: 40000 } }));
  assert.equal(state.cash.freeCash, 40000);
  assert.equal(state.cash.runway, 3.25);
  assert.equal(state.primary.key, 'CASH');
});

test('critical cash takes precedence even over negative economics and full capacity', () => {
  const state = Engine.analyze(input({ cash: { bankCash: 50000 }, metrics: { directCosts: 250000, soldHours: 200, futureBookedHours: 320 } }));
  assert.equal(state.primary.key, 'CASH');
  assert.equal(state.cash.status, 'CRITICAL');
});

test('negative free cash, overdue liabilities and unfunded work each independently trigger cash override', () => {
  for (const cash of [{ bankCash: 180000 }, { overdueLiabilities: 10000 }, { unfundedWork: true }]) {
    assert.equal(Engine.analyze(input({ cash })).primary.key, 'CASH');
  }
});

test('zero denominators stay unknown while genuine zero revenue and profit stay zero', () => {
  const state = Engine.analyze(input({ metrics: { revenue: 0, directCosts: 0, actualHours: 0, completedJobs: 0, jobsWon: 0, quotesSent: 0, wonQuotes: 0, qualifiedLeads: 0, availableHours: 0, dailyAvailableHours: 0, estimatedDirectCosts: 0 }, cash: { weeklyBurn: 0 } }));
  assert.equal(state.metrics.grossProfit, 0);
  assert.equal(state.metrics.crewDays, 0);
  for (const key of ['grossMargin', 'gpPerCrewDay', 'quoteWinRate', 'leadWinRate', 'leadQuoteRate', 'utilization', 'backlogDays', 'costVariance', 'averageTicket']) assert.equal(state.metrics[key], null, key);
  assert.equal(state.cash.runway, null);
  assert.equal(state.cash.status, 'UNKNOWN');
  assert.ok(!JSON.stringify(state).includes('Infinity'));
});

test('missing data never becomes zero, green health or a definite diagnosis', () => {
  const state = Engine.analyze({});
  assert.equal(state.stage.number, null);
  assert.equal(state.metrics.revenue, null);
  assert.equal(state.metrics.grossProfit, null);
  assert.equal(state.cash.bankCash, null);
  assert.equal(state.cash.freeCash, null);
  assert.equal(state.cash.status, 'UNKNOWN');
  assert.equal(state.primary, null);
  assert.equal(state.confidence, 'LOW');
  assert.equal(state.constraints.length, 8);
  assert.ok(state.constraints.every(constraint => constraint.score === null && constraint.status === 'UNKNOWN'));
});

test('one missing reserve makes free cash unknown but a known risk remains actionable', () => {
  const state = Engine.analyze(input({ cash: { payrollReserve: null, weeklyBurn: 200000 } }));
  assert.equal(state.cash.freeCash, null);
  assert.equal(state.cash.runway, 2.5);
  assert.equal(state.primary.key, 'CASH');
  assert.equal(state.primary.confidence, 'LOW');
});

test('validation uses paid completed jobs and wins over premature team labels', () => {
  for (const completedPaidJobs of [0, 4, 9]) {
    const state = Engine.analyze(input({ completedPaidJobs, team: { independent: true, crews: 3, locations: 2, national: true } }));
    assert.equal(state.stage.number, 1);
  }
  assert.equal(Engine.analyze(input({ completedPaidJobs: 10 })).stage.number, 2);
  assert.equal(Engine.analyze(input({ completedPaidJobs: 150 })).stage.number, 2, 'volume alone cannot establish a team');
  assert.equal(Engine.analyze(input({ team: { independent: true } })).stage.number, 3);
  assert.equal(Engine.analyze(input({ team: { independent: true, crews: 2 } })).stage.number, 4);
  assert.equal(Engine.analyze(input({ team: { independent: true, crews: 2, national: true } })).stage.number, 5);
});

test('people is an upstream capacity cause only after team validation', () => {
  const metrics = { soldHours: 190, futureBookedHours: 300, understaffed: 1 };
  assert.equal(Engine.analyze(input({ completedPaidJobs: 4, team: { independent: true }, metrics })).primary.key, 'CAPACITY');
  assert.equal(Engine.analyze(input({ team: { independent: true }, metrics })).primary.key, 'PEOPLE');
});

test('founder field work is not a leverage warning during validation', () => {
  const metrics = { founderDelegatableHours: 35, founderHours: 40 };
  assert.equal(Engine.analyze(input({ completedPaidJobs: 4, metrics })).constraints.find(item => item.key === 'FOUNDER_LEVERAGE').score, null);
  assert.equal(Engine.analyze(input({ metrics })).primary.key, 'FOUNDER_LEVERAGE');
});

test('partial periods lower confidence and cannot imply insufficient lead volume', () => {
  const state = Engine.analyze(input({ period: { start: '2026-09-14', end: '2026-09-20', partial: true }, metrics: { qualifiedLeads: 8, quotesSent: 8, wonQuotes: 3, jobsWon: 3, soldHours: 80, futureBookedHours: 32 } }));
  assert.notEqual(state.primary && state.primary.key, 'DEMAND');
  assert.equal(state.confidence, 'LOW');
});

test('invalid and inconsistent counts are rejected rather than clamped into healthy rates', () => {
  const state = Engine.analyze(input({ metrics: { revenue: NaN, directCosts: -2, actualHours: Infinity, wonQuotes: 30, qualifiedLeads: 1.5, reworkRate: 2 } }));
  assert.equal(state.metrics.grossProfit, null);
  assert.equal(state.metrics.quoteWinRate, null);
  assert.equal(state.metrics.qualifiedLeads, null);
  assert.equal(state.metrics.reworkRate, null);
  assert.ok(state.dataIssues.length >= 5);
});

test('all benchmarks and workday hours use editable settings with invalid ordering guarded', () => {
  const custom = Engine.defaults(); custom.standardWorkdayHours = 10; custom.operatingReserve = 100000;
  const state = Engine.analyze(input(), custom);
  assert.equal(state.metrics.crewDays, 16);
  assert.equal(state.cash.freeCash, 360000);
  assert.equal(Engine.defaults().standardWorkdayHours, 8);
  const broken = Engine.analyze(input(), { standardWorkdayHours: 0, minCriticalRunway: 40, minRunway: 3 });
  assert.equal(broken.settings.standardWorkdayHours, 8);
  assert.equal(broken.settings.minCriticalRunway, 4);
  assert.ok(broken.dataIssues.length >= 2);
});

const flow = (id, date, amount, direction = 'in', layer = 'committed', probability = 1, sourceId) => ({ id, sourceId, date, amount, direction, layer, probability, category: 'other', label: id });

test('13-week forecast keeps committed cash and probability-weighted expected scenario independent', () => {
  const result = Engine.forecast(100000, [flow('invoice', '2026-09-15', 20000), flow('payroll', '2026-09-18', 10000, 'out'), flow('job', '2026-09-16', 100000, 'in', 'expected', 0.5), flow('rent', '2026-09-22', 5000, 'out'), flow('possibleCost', '2026-09-22', 10000, 'out', 'expected', 0.5)], '2026-09-14');
  assert.equal(result.weeks.length, 13);
  assert.equal(result.weeks[0].committed, 110000);
  assert.equal(result.weeks[0].expected, 160000);
  assert.equal(result.weeks[1].committed, 105000);
  assert.equal(result.weeks[1].expected, 150000);
  assert.equal(result.weeks[12].committed, 105000);
  assert.equal(result.weeks[12].expected, 150000);
  assert.equal(result.weeks[0].start, '2026-09-14');
  assert.equal(result.weeks[0].end, '2026-09-20');
});

test('forecast deduplicates sources across expected and committed without adding historical transactions', () => {
  const items = [flow('booked', '2026-09-16', 100000, 'in', 'expected', 0.5, 'job-1'), flow('invoice', '2026-09-17', 100000, 'in', 'committed', 1, 'job-1'), flow('same-invoice', '2026-09-17', 100000, 'in', 'committed', 1, 'job-1'), flow('late', '2026-09-10', 50000)];
  const result = Engine.forecast(100000, items, '2026-09-14');
  assert.equal(result.weeks[0].committed, 200000);
  assert.equal(result.weeks[0].expected, 200000);
  assert.equal(result.overdue.length, 1);
  assert.ok(result.issues.some(message => message.includes('Duplicitní')));
});

test('forecast handles missing balance, invalid dates and invalid item probabilities', () => {
  const result = Engine.forecast(null, [flow('invalid', '2026-02-30', 50), flow('badprob', '2026-09-14', 50, 'in', 'expected', 2), flow('valid', '2026-09-15', 10)], '2026-09-14');
  assert.equal(result.weeks[0].inflows, 10);
  assert.equal(result.weeks[0].committed, null);
  assert.equal(result.weeks[0].expected, null);
  assert.equal(result.issues.filter(message=>message.includes('Neplatná položka')).length, 2);
  assert.ok(result.issues.some(message=>message.includes('žádné závazné výdaje')));
  assert.equal(Engine.forecast(10, [], '2026-02-30').weeks.length, 0);
});

function demandState() { return Engine.analyze(input({ metrics: { qualifiedLeads: 8, quotesSent: 8, wonQuotes: 3, jobsWon: 3, soldHours: 80, futureBookedHours: 32 } })); }
function decision(overrides = {}) { return { title: 'Ověřený zdroj poptávek', type: 'marketing', oneTimeCost: 3000, monthlyCost: 1000, founderHours: 3, monthlyRevenueImpact: 20000, monthlySavings: 0, capacityHours: 0, feedbackDays: 7, reversibility: 5, evidence: 'historical', targetConstraint: 'DEMAND', metric: 'Kvalifikované poptávky', cheaperTest: 'Omezený test jednoho zdroje', ...overrides }; }

test('decision uses incremental gross profit, reserves first month once and does not fund runway with sales guesses', () => {
  const result = Engine.evaluateDecision(decision(), demandState());
  assert.equal(result.verdict, 'DO');
  assert.equal(result.constraintFit, 'YES');
  assert.equal(result.remainingFreeCash, 406000);
  assert.equal(result.runwayBefore, 25);
  near(result.runwayAfter, 497000 / (20000 + 1000 * 12 / 52));
  assert.equal(result.incrementalMonthlyGrossProfit, 7000);
  near(result.paybackMonths, 3000 / 7000);
});

test('decision with insufficient cash is WAIT even when nominal return is excellent', () => {
  const result = Engine.evaluateDecision(decision({ oneTimeCost: 450000, monthlyRevenueImpact: 1000000 }), demandState());
  assert.equal(result.verdict, 'WAIT');
  assert.ok(result.flags.includes('CASH_RISK'));
  assert.equal(result.remainingFreeCash, -41000);
});

test('decision intent is explicit and never guessed from a matching title', () => {
  const result = Engine.evaluateDecision(decision({ title: 'Vyřešit poptávky reklamou', type: 'capex', targetConstraint: 'CAPACITY', capacityHours: 20 }), demandState());
  assert.equal(result.constraintFit, 'NO');
  assert.equal(result.verdict, 'WAIT');
});

test('validation expansion and slow unmeasured software trigger founder guardrails', () => {
  const state = demandState(); state.stage.number = 1;
  const expansion = Engine.evaluateDecision(decision({ type: 'expansion' }), state);
  assert.equal(expansion.verdict, 'WAIT');
  assert.ok(expansion.flags.includes('PREMATURE_OPTIMIZATION'));
  const software = Engine.evaluateDecision(decision({ type: 'software', feedbackDays: 14, metric: '', cheaperTest: '' }), state);
  assert.equal(software.verdict, 'WAIT');
  assert.ok(software.flags.includes('LIKELY_PRODUCTIVE_PROCRASTINATION'));
});

test('missing decision costs and unknown margins never manufacture ROI or a greenlight', () => {
  const state = demandState(); state.metrics.grossMargin = null;
  const result = Engine.evaluateDecision(decision({ oneTimeCost: null }), state);
  assert.equal(result.verdict, 'NEED_DATA');
  assert.equal(result.remainingFreeCash, null);
  assert.equal(result.paybackMonths, null);
  assert.equal(result.incrementalMonthlyGrossProfit, null);
  assert.equal(result.runwayAfter, null);
});

test('weak evidence produces a test and zero return has no fictitious payback', () => {
  const result = Engine.evaluateDecision(decision({ evidence: 'guess', monthlyRevenueImpact: 0, monthlySavings: 0 }), demandState());
  assert.equal(result.verdict, 'TEST');
  assert.equal(result.paybackMonths, null);
  assert.equal(result.incrementalMonthlyGrossProfit, -1000);
  assert.ok(result.flags.includes('NON_POSITIVE_RETURN'));
});

test('weekly plan gives one bounded experiment and at most three actions; cash risk allows no spend', () => {
  const plan = Engine.weeklyPlan(demandState());
  assert.ok(plan.objective);
  assert.equal(plan.experiment.budget, 3000);
  assert.equal(plan.actions.length, 3);
  const cashPlan = Engine.weeklyPlan(Engine.analyze(input({ cash: { bankCash: 10000 } })));
  assert.equal(cashPlan.experiment.budget, 0);
  const unknown = Engine.weeklyPlan(Engine.analyze({}));
  assert.equal(unknown.experiment.budget, 0);
});

const explanation = () => ({ interpretation: 'Zvolený constraint podporují uvedené údaje.', facts: ['Firma má volné hodiny.'], assumptions: ['Test může zvýšit kvalifikovanou poptávku.'], primaryMove: 'Otestovat jeden zdroj.', actions: ['Změřit výsledek testu.'], avoid: ['Neřešit expanzi.'], questions: [] });

test('stale cash cannot fund a weekly experiment and every plan has a measured objective', () => {
  const state = demandState();
  assert.ok(Engine.weeklyPlan(state).experiment.budget > 0);
  assert.match(Engine.weeklyPlan(state).objective, /\d/);
  state.cash.fresh = false;
  assert.equal(Engine.weeklyPlan(state).experiment.budget, 0);
});

test('cash deficits have zero remaining runway and still prohibit further spend', () => {
  const state = Engine.analyze(input({cash:{bankCash:1000}}));
  assert.ok(state.cash.survivalCash < 0);
  assert.equal(state.cash.runway, 0);
  const result = Engine.evaluateDecision(decision({oneTimeCost:900000}), state);
  assert.equal(result.verdict, 'WAIT');
  assert.equal(result.runwayAfter, 0);
});

test('incomplete risk evidence is tentative and green evidence does not claim a problem', () => {
  const state = Engine.analyze(input({metrics:{qualifiedLeads:2,soldHours:30,wonQuotes:null}}));
  const demand = state.constraints.find(x => x.key === 'DEMAND');
  assert.equal(demand.confidence, 'LOW');
  assert.match(demand.explanation, /Část dat chybí/);
  const green = Engine.analyze(input()).constraints.find(x => x.status === 'GREEN');
  assert.match(green.explanation, /nepřekračují/);
});

test('AI schema is explanation-only, bounded and rejects extra math or empty responses', () => {
  assert.equal(Engine.validateAIResponse(explanation()).valid, true);
  assert.equal(Engine.validateAIResponse({ ...explanation(), revenue: 1000 }).valid, false);
  assert.equal(Engine.validateAIResponse({ ...explanation(), actions: ['a', 'b', 'c', 'd'] }).valid, false);
  assert.equal(Engine.validateAIResponse({ ...explanation(), actions: [] }).valid, false);
  assert.equal(Engine.validateAIResponse({ ...explanation(), interpretation: '' }).valid, false);
  assert.equal(Engine.validateAIResponse(null).valid, false);
});

test('optional AI provider receives a cloned structured state and cannot mutate calculations', async () => {
  const state = demandState();
  const revenue = state.metrics.revenue;
  const interpreted = await Engine.interpret(state, async payload => { payload.metrics.revenue = -999; return explanation(); });
  assert.equal(interpreted.source, 'ai');
  assert.equal(state.metrics.revenue, revenue);
  const fallback = await Engine.interpret(state, async () => ({ ...explanation(), money: 90000 }));
  assert.equal(fallback.source, 'rules');
  assert.ok(fallback.validationErrors.length);
  assert.equal((await Engine.interpret(state)).source, 'rules');
  assert.equal((await Engine.interpret(state, async () => { throw Error('unavailable'); })).source, 'rules');
});

test('analysis, forecast and decision never mutate caller data', () => {
  const raw = input(); const before = JSON.stringify(raw);
  const state = Engine.analyze(raw);
  assert.equal(JSON.stringify(raw), before);
  const proposal = decision(); const proposalBefore = JSON.stringify(proposal);
  Engine.evaluateDecision(proposal, state);
  assert.equal(JSON.stringify(proposal), proposalBefore);
  const items = [flow('in', '2026-09-15', 20)]; const itemsBefore = JSON.stringify(items);
  Engine.forecast(100, items, '2026-09-14');
  assert.equal(JSON.stringify(items), itemsBefore);
});
