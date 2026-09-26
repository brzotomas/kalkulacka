const test = require('node:test');
const assert = require('node:assert/strict');
const Adapter = require('../founder/adapter.js');
const AS_OF = '2026-09-16';
const options = extra => ({ asOf: AS_OF, period: 'week', planJob: job => ({ hod: job.plannedHours ?? 40 }), ...extra });
function state(jobs = []) {
  const founderOs = Adapter.defaults();
  founderOs.weeklyInputs = [{ week: '2026-09-14', qualifiedLeads: 5, availableHours: 80, founderHours: 30, founderDelegatableHours: 10, understaffed: false }];
  founderOs.cash = { bankCash: 50000, taxReserve: 5000, payrollReserve: 10000, committedPayables: 2000, customerAdvanceReserve: 0, weeklyBurn: 8000, overdueLiabilities: 0, unfundedWork: 0, asOf: '2026-09-15' };
  return { zakazky: jobs, founderOs };
}
function job(extra = {}) {
  return {
    id: 'a', nazev: 'Zakázka A', status: 'hotovo', dph: '21', vysCelkem: 12100, vysZisk: 77777,
    skutHodiny: 20, terminOd: '2026-09-14', terminDo: '2026-09-18', viceprace: [],
    zalohaCastka: 4000, zalohaZaplaceno: '2026-09-14', doplatekCastka: 8100, doplatekZaplaceno: '2026-09-16',
    founder: { leadDate: '2026-09-14', quoteDate: '2026-09-14', wonDate: '2026-09-15', completedDate: '2026-09-16', actualDirectCosts: 3000, actualRevenue: null, onTimeStart: true, reworkHours: 0 },
    ...extra
  };
}

test('defaults and migration preserve user history and explicit zero values', () => {
  const S = { cenik: ['unchanged'], founderOs: { version: 1, settings: { standardWorkdayHours: 6 }, cash: { bankCash: 0 }, decisions: [{ id: 'decision' }], memory: [{ id: 'memory' }] } };
  const existingDecision = S.founderOs.decisions;
  const result = Adapter.ensure(S);
  assert.strictEqual(result, S.founderOs);
  assert.strictEqual(result.decisions, existingDecision);
  assert.equal(result.cash.bankCash, 0);
  assert.equal(result.cash.taxReserve, null);
  assert.equal(result.settings.standardWorkdayHours, 6);
  assert.equal(result.memory.length, 1);
  assert.deepEqual(S.cenik, ['unchanged']);
  const a = Adapter.defaults(), b = Adapter.defaults();
  a.weeklyInputs.push({ week: 'a' });
  assert.equal(b.weeklyInputs.length, 0);
});

test('empty sources remain unknown instead of creating plausible zero business metrics', () => {
  const input = Adapter.buildInput({}, options());
  for (const key of ['qualifiedLeads', 'quotesSent', 'revenue', 'directCosts', 'actualHours', 'availableHours', 'soldHours', 'futureBookedHours']) assert.equal(input.metrics[key], null, key);
  assert.equal(input.cash.bankCash, null);
  assert.equal(input.completedPaidJobs, 0);
  assert.ok(input.dataIssues.some(text => text.includes('Nejsou uložené')));
});

test('realized revenue strips VAT, keeps valid zero actual costs, and never uses saved profit as cost', () => {
  const first = job({ founder: { ...job().founder, actualDirectCosts: 0 } });
  const second = job({ id: 'b', dph: '12', vysCelkem: 11200 });
  const third = job({ id: 'c', dph: 'rc', vysCelkem: 10000 });
  const input = Adapter.buildInput(state([first, second, third]), options());
  assert.equal(input.metrics.revenue, 30000);
  assert.equal(input.metrics.directCosts, 6000);
  assert.equal(input.sources.actualCostJobs, 3);
  assert.equal(input.sources.agreedRevenueJobs, 3);
  assert.ok(input.dataIssues.some(text => text.includes('sjednané ceny bez DPH')));
  first.founder.actualRevenue = 9000;
  second.founder.actualDirectCosts = null;
  const updated = Adapter.buildInput(state([first, second, third]), options());
  assert.equal(updated.metrics.revenue, 29000);
  assert.equal(updated.metrics.directCosts, null);
  assert.equal(updated.sources.actualCostJobs, 2);
});

test('missing completed date is not inferred from save date and remains visible only in all history', () => {
  const undated = job({ ulozeno: '2026-09-16T12:00:00Z', founder: { ...job().founder, completedDate: '' } });
  const S = state([undated]);
  const current = Adapter.buildInput(S, options());
  assert.equal(current.sources.completed, 0);
  assert.equal(current.metrics.revenue, null);
  assert.ok(current.dataIssues.some(text => text.includes('datum dokončení')));
  const all = Adapter.buildInput(S, options({ period: 'all' }));
  assert.equal(all.sources.completed, 1);
  assert.equal(all.metrics.revenue, 10000);
});

test('actual daily person-hours multiply people without doubling explicit actual hours', () => {
  const daily = [{ datum: '2026-09-14', lide: 2, hodiny: 8 }, { datum: '2026-09-15', lide: 3, hodiny: 4 }];
  const first = job({ skutHodiny: 0, denniZapis: daily });
  const second = job({ id: 'b', skutHodiny: 10, denniZapis: daily });
  const input = Adapter.buildInput(state([first, second]), options());
  assert.equal(input.metrics.actualHours, 38);
  assert.equal(input.metrics.reworkRate, 0);
});

test('paid completed phase requires full gross payment coverage and actual dated payment', () => {
  const full = job();
  const partial = job({ id: 'partial', doplatekZaplaceno: '' });
  const uncovered = job({ id: 'uncovered', doplatekCastka: 0 });
  const future = job({ id: 'future', doplatekZaplaceno: '2026-09-20' });
  const actualRevenueOnly = job({ id: 'revenue-only', zalohaCastka: 0, doplatekCastka: 0, founder: { ...job().founder, actualRevenue: 10000 } });
  assert.equal(Adapter.buildInput(state([full, partial, uncovered, future, actualRevenueOnly]), options()).completedPaidJobs, 1);
});

test('offer cohort counts only explicit sent dates and separates win date from cohort wins', () => {
  const newDraft = job({ id: 'draft', status: 'nabídka', founder: {} });
  const quoteWonLater = job({ id: 'sent', status: 'domluveno', founder: { quoteDate: '2026-09-15', wonDate: '2026-09-16' } });
  const oldQuoteWonNow = job({ id: 'old', status: 'domluveno', founder: { quoteDate: '2026-09-09', wonDate: '2026-09-15' } });
  const rejected = job({ id: 'lost', status: 'zamítnuto', duvodProhry: 'Nevyhovoval termín', founder: { quoteDate: '2026-09-14' } });
  const input = Adapter.buildInput(state([newDraft, quoteWonLater, oldQuoteWonNow, rejected]), options());
  assert.equal(input.metrics.quotesSent, 2);
  assert.equal(input.metrics.wonQuotes, 1);
  assert.equal(input.metrics.jobsWon, 2);
  assert.equal(input.metrics.lostCount, 1);
  assert.equal(input.metrics.lostTiming, 1);
});

test('sold hours distribute across workdays; remaining backlog includes approved additional work', () => {
  const booked = job({ status: 'probíhá', plannedHours: 80, skutHodiny: 20, terminOd: '2026-09-11', terminDo: '2026-09-21', viceprace: [{ stav: 'odsouhlaseno', hod: 4 }, { stav: 'navrženo', hod: 100 }] });
  const input = Adapter.buildInput(state([booked]), options());
  assert.equal(input.metrics.soldHours, 60); // 84 h / 7 working days × 5 current days
  assert.equal(input.metrics.futureBookedHours, 64);
  assert.equal(input.metrics.dailyAvailableHours, 16);
});

test('all weeks must have known capacity; duplicate weekly inputs are not added together', () => {
  const S = state([job()]);
  const missing = Adapter.buildInput(S, options({ period: '4weeks' }));
  assert.equal(missing.metrics.availableHours, null);
  assert.equal(missing.sources.weeksRequired, 4);
  S.founderOs.weeklyInputs.push({ week: '2026-09-14', availableHours: 100, qualifiedLeads: 0, founderHours: 0, founderDelegatableHours: 0, understaffed: false });
  const current = Adapter.buildInput(S, options());
  assert.equal(current.metrics.availableHours, 100);
  assert.equal(current.metrics.qualifiedLeads, 0);
  assert.ok(current.dataIssues.some(text => text.includes('Duplicitní')));
});

test('cash forecast uses original gross payment rows and exposes overdue and undated gaps', () => {
  const committed = job({ status: 'domluveno', zalohaZaplaceno: '', zalohaSplatnost: '2026-09-15', doplatekZaplaceno: '', doplatekSplatnost: '' });
  const quote = job({ id: 'quote', status: 'nabídka', zalohaZaplaceno: '', zalohaSplatnost: '2026-09-20', doplatekCastka: 0 });
  const S = state([committed, quote]);
  S.founderOs.cash.asOf = '2026-09-01';
  const input = Adapter.buildInput(S, options());
  assert.equal(input.cashItems.length, 2);
  assert.equal(input.cashItems[0].sourceId, 'job:a:zaloha');
  assert.equal(input.cashItems[0].amount, 4000);
  assert.equal(input.cashItems[0].probability, 1);
  assert.equal(input.cashItems[0].overdue, true);
  assert.equal(input.cashItems[1].probability, 0.3);
  assert.equal(input.sources.undatedPayments, 1);
  assert.equal(input.sources.overduePayments, 1);
  assert.ok(input.dataIssues.some(text => text.includes('starší než 7 dní')));
});

test('consecutive losses mean negative gross profit, with unknown newest result blocking inference', () => {
  const profitable = job({ id: 'p', founder: { ...job().founder, completedDate: '2026-09-10' } });
  const losing1 = job({ id: 'l1', founder: { ...job().founder, completedDate: '2026-09-14', actualDirectCosts: 11000 } });
  const losing2 = job({ id: 'l2', founder: { ...job().founder, completedDate: '2026-09-15', actualDirectCosts: 12000 } });
  const rejected = job({ id: 'rejected', status: 'zamítnuto' });
  const S = state([losing1, rejected, profitable, losing2]);
  assert.equal(Adapter.buildInput(S, options()).metrics.consecutiveLosses, 2);
  profitable.founder.actualDirectCosts = null;
  assert.equal(Adapter.buildInput(S, options()).metrics.consecutiveLosses, 2);
  losing2.founder.actualDirectCosts = null;
  assert.equal(Adapter.buildInput(S, options()).metrics.consecutiveLosses, null);
});

test('negative bank cash remains visible instead of disappearing as unknown', () => {
  const S = state([job()]);
  S.founderOs.cash.bankCash = -2000;
  assert.equal(Adapter.buildInput(S, options()).cash.bankCash, -2000);
});

test('buildInput is pure, including against a mutating legacy plan callback', () => {
  const S = state([job()]);
  const original = JSON.stringify(S);
  Adapter.buildInput(S, options({ planJob: job => { job.nazev = 'changed'; job.founder.actualRevenue = 123; return { hod: 40 }; } }));
  assert.equal(JSON.stringify(S), original);
});

test('previous week has independent Monday-Sunday boundaries and rejects impossible dates', () => {
  const S = state([job({ founder: { ...job().founder, completedDate: '2026-02-30' } })]);
  const input = Adapter.buildInput(S, options({ period: 'previous' }));
  assert.equal(input.period.start, '2026-09-07');
  assert.equal(input.period.end, '2026-09-13');
  assert.equal(input.period.partial, false);
  assert.equal(input.sources.undatedCompleted, 1);
});
