/* Founder OS: deterministic business rules. Money is CZK, ratios are fractions.
 * Browser: FounderEngine. Node: require('./engine.js'). No database or DOM access.
 * Undefined, non-finite and invalid inputs stay unknown (null), never become zero.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FounderEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** @typedef {number|null} KnownNumber */
  /** @typedef {'HIGH'|'MEDIUM'|'LOW'} Confidence */
  /** @typedef {'DEMAND'|'CONVERSION'|'CAPACITY'|'ECONOMICS'|'CASH'|'DELIVERY'|'PEOPLE'|'FOUNDER_LEVERAGE'} ConstraintKey */

  const METRICS = ['qualifiedLeads', 'quotesSent', 'wonQuotes', 'jobsWon', 'revenue', 'directCosts', 'actualHours', 'availableHours', 'soldHours', 'futureBookedHours', 'dailyAvailableHours', 'estimatedDirectCosts', 'consecutiveLosses', 'lostTiming', 'lostCount', 'lateStartRate', 'reworkRate', 'founderDelegatableHours', 'founderHours', 'understaffed'];
  const CASH_FIELDS = ['bankCash', 'taxReserve', 'payrollReserve', 'committedPayables', 'customerAdvanceReserve', 'weeklyBurn', 'overdueLiabilities'];
  const KEYS = ['DEMAND', 'CONVERSION', 'CAPACITY', 'ECONOMICS', 'CASH', 'DELIVERY', 'PEOPLE', 'FOUNDER_LEVERAGE'];
  const DEFAULTS = Object.freeze({
    standardWorkdayHours: 8,
    targetGrossMargin: 0.30,
    minGrossMargin: 0.20,
    minGpPerCrewDay: 1500,
    targetQuoteWinRate: 0.30,
    minQuoteWinRate: 0.20,
    targetUtilization: 0.80,
    lowUtilization: 0.65,
    highUtilization: 0.85,
    maxBacklogDays: 10,
    lowBacklogDays: 3,
    targetQualifiedLeads: 15,
    minCriticalRunway: 4,
    minRunway: 8,
    healthyRunway: 12,
    significantOverdueLiabilities: 10000,
    maxCostVariance: 0.15,
    maxLateStartRate: 0.10,
    maxReworkRate: 0.05,
    minConsecutiveLosses: 3,
    founderDelegationRatio: 0.40,
    operatingReserve: 50000,
    minimumJobValue: 5000,
    experimentBudget: 3000,
    minimumExperimentLeads: 6,
    maxExperimentCashFraction: 0.10,
    maxFeedbackDays: 7,
    minimumEvidenceJobs: 10,
    highConfidenceJobs: 30,
    maxPaybackMonths: 12,
    minimumEvidenceQuotes: 5
  });
  const RATIO_SETTINGS = new Set(['targetGrossMargin', 'minGrossMargin', 'targetQuoteWinRate', 'minQuoteWinRate', 'targetUtilization', 'lowUtilization', 'highUtilization', 'maxLateStartRate', 'maxReworkRate', 'founderDelegationRatio', 'maxExperimentCashFraction']);

  /** Return an independent editable settings object. */
  function defaults() { return Object.assign({}, DEFAULTS); }
  function known(value) { return typeof value === 'number' && Number.isFinite(value); }
  function num(value, allowNegative) { return known(value) && (allowNegative || value >= 0) ? value : null; }
  function ratio(top, bottom) { return known(top) && known(bottom) && bottom > 0 ? finite(top / bottom) : null; }
  function finite(value) { return Number.isFinite(value) ? value : null; }
  function minus(left, right) { return known(left) && known(right) ? finite(left - right) : null; }
  function sum(values) { return values.every(known) ? finite(values.reduce((total, value) => total + value, 0)) : null; }
  function money(value) { return known(value) ? Math.round(value).toLocaleString('cs-CZ') + ' Kč' : 'neznámé'; }
  function pct(value) { return known(value) ? (value * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' %' : 'neznámé'; }
  function decimal(value) { return known(value) ? value.toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) : 'neznámé'; }
  function text(value) { return typeof value === 'string' ? value.trim() : ''; }
  function unique(values) { return Array.from(new Set(values)); }
  function isDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value; }
  function addDays(date, days) { return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
  function normalizeSettings(input, issues) {
    const result = defaults();
    Object.keys(DEFAULTS).forEach(function (key) {
      if (!input || !Object.prototype.hasOwnProperty.call(input, key)) return;
      const value = input[key];
      if (!known(value) || value < 0 || (RATIO_SETTINGS.has(key) && value > 1) || (['standardWorkdayHours', 'targetQualifiedLeads', 'maxFeedbackDays'].includes(key) && value === 0)) {
        if (issues) issues.push('Neplatný limit ' + key + '; použit bezpečný výchozí limit.');
      } else result[key] = value;
    });
    const ordered = [
      ['minGrossMargin', 'targetGrossMargin'], ['minQuoteWinRate', 'targetQuoteWinRate'],
      ['lowUtilization', 'targetUtilization', 'highUtilization'], ['lowBacklogDays', 'maxBacklogDays'],
      ['minCriticalRunway', 'minRunway', 'healthyRunway'], ['minimumEvidenceJobs', 'highConfidenceJobs']
    ];
    ordered.forEach(function (keys) {
      if (keys.some((key, index) => index > 0 && result[key] < result[keys[index - 1]])) {
        keys.forEach(key => { result[key] = DEFAULTS[key]; });
        if (issues) issues.push('Limity ' + keys.join(' / ') + ' nejsou vzestupné; použity výchozí hodnoty.');
      }
    });
    return result;
  }

  function stageFor(jobs, team) {
    if (!known(jobs)) return { number: null, key: 'unknown', label: 'Fáze není doložena' };
    if (jobs < 10) return { number: 1, key: 'validation', label: 'Validation · prvních 10 zakázek' };
    if (team && team.national === true && team.independent === true && (num(team.crews) >= 2 || num(team.locations) >= 2)) return { number: 5, key: 'scale', label: 'Scale · národní působnost' };
    if (team && team.independent === true && (num(team.crews) >= 2 || num(team.locations) >= 2)) return { number: 4, key: 'multiple_crews', label: 'Více týmů / lokalit' };
    if (team && team.independent === true && num(team.crews) >= 1) return { number: 3, key: 'first_team', label: 'První samostatný tým' };
    return { number: 2, key: 'repeatability', label: 'Repeatability · opakovatelná ekonomika' };
  }

  function cashState(input, settings) {
    const cash = {};
    CASH_FIELDS.forEach(key => { cash[key] = num(input && input[key], key === 'bankCash'); });
    cash.unfundedWork = input && typeof input.unfundedWork === 'boolean' ? input.unfundedWork : null;
    cash.operatingReserve = settings.operatingReserve;
    // Reserves must be disjoint buckets: payroll excludes supplier payables;
    // customer advances are only the restricted amount not already reserved elsewhere.
    cash.reservedCash = sum([cash.taxReserve, cash.payrollReserve, cash.committedPayables, cash.customerAdvanceReserve, cash.operatingReserve]);
    cash.freeCash = minus(cash.bankCash, cash.reservedCash);
    // Survival burn already includes recurring payroll. Subtract one-off commitments,
    // tax and restricted advances, but do NOT subtract payroll or operating reserve
    // again from runway. The reserve is spendable in a survival scenario.
    cash.survivalCash = known(cash.bankCash) ? minus(cash.bankCash, sum([cash.taxReserve, cash.committedPayables, cash.customerAdvanceReserve])) : null;
    cash.runway = ratio(known(cash.survivalCash) ? Math.max(0, cash.survivalCash) : null, cash.weeklyBurn);
    const critical = (known(cash.freeCash) && cash.freeCash < 0) || (known(cash.runway) && cash.runway < settings.minCriticalRunway) || (known(cash.overdueLiabilities) && cash.overdueLiabilities >= settings.significantOverdueLiabilities && cash.overdueLiabilities > 0) || cash.unfundedWork === true;
    const complete = [cash.freeCash, cash.runway, cash.overdueLiabilities].every(known) && cash.unfundedWork !== null;
    cash.status = critical ? 'CRITICAL' : !complete ? 'UNKNOWN' : cash.runway < settings.minRunway ? 'RISKY' : cash.runway <= settings.healthyRunway ? 'WATCH' : 'HEALTHY';
    return cash;
  }

  const ADVICE = {
    DEMAND: {
      label: 'Poptávka', explanation: 'Volná kapacita a krátký backlog při použitelné konverzi ukazují na nedostatek kvalifikovaných poptávek.',
      action: 'Otestovat jeden zdroj kvalifikovaných poptávek a změřit cenu i následné nabídky.',
      success: 'Více kvalifikovaných poptávek při zachování cílové marže.',
      avoid: ['Nekupovat další kapacitu bez zakázek.', 'Neřešit expanzi ani nový interní nástroj.']
    },
    CONVERSION: {
      label: 'Konverze', explanation: 'Poptávky přicházejí, ale nabídky se dostatečně nemění na získané zakázky.',
      action: 'Projít posledních pět prohraných nabídek, zjistit důvody a otestovat rychlejší follow-up.',
      success: 'Zvýšit úspěšnost nabídek při zachování minimální marže.',
      avoid: ['Nenavyšovat plošně reklamní rozpočet.', 'Nesnižovat automaticky ceny bez zjištění důvodu ztráty.']
    },
    CAPACITY: {
      label: 'Kapacita', explanation: 'Vytížení, čekací doba nebo ztráty kvůli termínu ukazují na nedostatek dostupných realizačních hodin.',
      action: 'Na pěti zakázkách otestovat dočasnou posilu nebo změnu plánování a porovnat zisk na pracovní den.',
      success: 'Backlog pod cílem při zachování minimálního zisku na pracovní den.',
      avoid: ['Nezvyšovat PPC, dokud nejsou dostupné termíny.', 'Neotvírat další oblast bez ověřené kapacity.']
    },
    ECONOMICS: {
      label: 'Ekonomika zakázek', explanation: 'Doložená ekonomika zakázek nedosahuje minima. Další objem by mohl prohloubit ztrátu.',
      action: 'Rozebrat skutečné náklady posledních zakázek a otestovat opravenou kalkulaci na dalších třech nabídkách.',
      success: 'Nové zakázky splní minimální marži i zisk na pracovní den.',
      avoid: ['Neškálovat ztrátové zakázky reklamou.', 'Nenabírat fixní náklady před opravou kalkulace.']
    },
    CASH: {
      label: 'Hotovost', explanation: 'Dostupná hotovost, splatné závazky nebo runway omezují bezpečný provoz firmy.',
      action: 'Sestavit plán inkasa a nezbytných plateb na 13 týdnů; vyřešit nejbližší nekrytý závazek.',
      success: 'Volná hotovost je nezáporná, prodané práce jsou kryté a runway nad kritickým limitem.',
      avoid: ['Nezvyšovat fixní náklady.', 'Neutratit daňové rezervy ani vázané klientské zálohy.']
    },
    DELIVERY: {
      label: 'Realizace a kvalita', explanation: 'Odchylky nákladů, opravy nebo opožděné nástupy omezují spolehlivost realizace.',
      action: 'U další zakázky zavést předávací checklist a dohledat jednu příčinu opakovaných odchylek.',
      success: 'Klesá podíl oprav a zpoždění; skutečné náklady zůstávají v nastavené toleranci.',
      avoid: ['Nepřidávat objem před stabilizací kvality.', 'Neřešit problém pouze dalším marketingem.']
    },
    PEOPLE: {
      label: 'Lidé', explanation: 'Kapacitu samostatného týmu omezuje doložený nedostatek lidí.',
      action: 'Otestovat jednu posilu s jasným zaškolením, odpovědností a měřením produktivity.',
      success: 'Rostou dodané hodiny a klesá backlog bez zhoršení ekonomiky a kvality.',
      avoid: ['Nabírat bez popisu výsledku a plánu zaškolení.', 'Přidávat poptávku bez kapacity týmu.']
    },
    FOUNDER_LEVERAGE: {
      label: 'Závislost na zakladateli', explanation: 'Velký podíl času zakladatele tvoří delegovatelná práce v již ověřené firmě.',
      action: 'Předat jeden opakovaný úkol s checklistem a změřit uvolněné hodiny zakladatele.',
      success: 'Klesne delegovatelný čas zakladatele a předaný výstup si zachová kvalitu.',
      avoid: ['Neautomatizovat proces, který zatím není stabilní.', 'Nezakládat další projekt místo předání jedné činnosti.']
    }
  };

  /** Analyze a normalized company snapshot. All ratios return null for zero denominator.
   * Counts and economics must refer to the same selected period/cohort in the adapter.
   * @param {object} input @param {object=} customSettings @returns {object}
   */
  function analyze(input, customSettings) {
    input = input || {};
    const dataIssues = Array.isArray(input.dataIssues) ? input.dataIssues.filter(item => typeof item === 'string') : [];
    const settings = normalizeSettings(customSettings, dataIssues);
    const metrics = {};
    METRICS.forEach(function (key) {
      const raw = input.metrics && input.metrics[key];
      metrics[key] = key === 'understaffed' && typeof raw === 'boolean' ? (raw ? 1 : 0) : num(raw);
      if (['lateStartRate', 'reworkRate'].includes(key) && metrics[key] > 1) metrics[key] = null;
      if (raw !== null && raw !== undefined && metrics[key] === null) dataIssues.push('Neplatný údaj ' + key + ' není použit ve výpočtu.');
    });
    const countKeys = ['qualifiedLeads', 'quotesSent', 'wonQuotes', 'jobsWon', 'consecutiveLosses', 'lostTiming', 'lostCount'];
    countKeys.forEach(key => {
      if (known(metrics[key]) && !Number.isInteger(metrics[key])) { metrics[key] = null; dataIssues.push('Počet ' + key + ' musí být celé číslo.'); }
    });
    const paidJobs = Number.isInteger(input.completedPaidJobs) ? num(input.completedPaidJobs) : null;
    if (paidJobs === null) dataIssues.push('Chybí doložený počet placených dokončených zakázek.');
    const team = Object.assign({}, input.team || {});
    const stage = stageFor(paidJobs, team);
    if (stage.number === 1 && (team.national === true || num(team.crews) > 1 || num(team.locations) > 1)) dataIssues.push('Více týmů či lokalit nemění fázi validace: zatím chybí prvních 10 placených dokončených zakázek.');
    metrics.grossProfit = minus(metrics.revenue, metrics.directCosts);
    metrics.grossMargin = ratio(metrics.grossProfit, metrics.revenue);
    metrics.crewDays = ratio(metrics.actualHours, settings.standardWorkdayHours);
    metrics.gpPerCrewDay = ratio(metrics.grossProfit, metrics.crewDays);
    metrics.revenuePerCrewDay = ratio(metrics.revenue, metrics.crewDays);
    metrics.quoteWinRate = ratio(metrics.wonQuotes, metrics.quotesSent);
    metrics.leadWinRate = ratio(metrics.jobsWon, metrics.qualifiedLeads);
    metrics.leadQuoteRate = ratio(metrics.quotesSent, metrics.qualifiedLeads);
    metrics.utilization = ratio(metrics.soldHours, metrics.availableHours);
    metrics.backlogDays = ratio(metrics.futureBookedHours, metrics.dailyAvailableHours);
    metrics.costVariance = ratio(minus(metrics.directCosts, metrics.estimatedDirectCosts), metrics.estimatedDirectCosts);
    metrics.completedJobs = Number.isInteger(input.metrics?.completedJobs) ? num(input.metrics.completedJobs) : null;
    metrics.averageTicket = ratio(metrics.revenue, metrics.completedJobs);
    metrics.timingLossRate = ratio(metrics.lostTiming, metrics.lostCount);
    metrics.founderDelegationShare = ratio(metrics.founderDelegatableHours, metrics.founderHours);
    [['wonQuotes', 'quotesSent', 'quoteWinRate'], ['jobsWon', 'qualifiedLeads', 'leadWinRate'], ['quotesSent', 'qualifiedLeads', 'leadQuoteRate'], ['lostTiming', 'lostCount', 'timingLossRate'], ['founderDelegatableHours', 'founderHours', 'founderDelegationShare']].forEach(function (keys) {
      if (known(metrics[keys[0]]) && known(metrics[keys[1]]) && metrics[keys[0]] > metrics[keys[1]]) {
        metrics[keys[2]] = null;
        dataIssues.push('Nesouhlasí rozsah dat: ' + keys[0] + ' je vyšší než ' + keys[1] + '. Poměr není určen.');
      }
    });
    const cash = cashState(input.cash || {}, settings);
    cash.asOf = isDate(input.cash?.asOf) ? input.cash.asOf : null;
    cash.fresh = !!cash.asOf && isDate(input.asOf) && cash.asOf <= input.asOf && Date.parse(input.asOf) - Date.parse(cash.asOf) <= 7 * 86400000;
    if (!cash.fresh) dataIssues.push('Cash snímek není aktuální; před schválením rozhodnutí jej ověřte.');
    if (!cash.fresh && cash.status !== 'CRITICAL') cash.status = 'UNKNOWN';
    CASH_FIELDS.forEach(key => { const raw = input.cash && input.cash[key]; if (raw != null && cash[key] === null) dataIssues.push('Neplatný peněžní údaj ' + key + ' není použit ve výpočtu.'); });
    if (cash.weeklyBurn === 0) dataIssues.push('Nulový týdenní burn: runway nelze konečně určit. Ověřte nezbytné výdaje včetně mezd.');
    if (!known(cash.freeCash)) dataIssues.push('Volná hotovost není určena: doplňte zůstatek a všechny oddělené rezervy, i když jsou nulové.');
    if (input.period && input.period.partial) dataIssues.push('Období není kompletní; objem leadů se nesrovnává s cílem pro celé období a důvěra je snížená.');
    if (!isDate(input.asOf)) dataIssues.push('Chybí platné datum stavu firmy.');
    if (input.period && (!isDate(input.period.start) || !isDate(input.period.end) || input.period.end < input.period.start)) dataIssues.push('Neplatné hranice vyhodnocovaného období.');
    if (known(paidJobs) && paidJobs < settings.minimumEvidenceJobs) dataIssues.push('Malý vzorek: pouze ' + paidJobs + ' placených dokončených zakázek; diagnóza je pracovní hypotéza.');

    const globalLow = !known(paidJobs) || paidJobs < settings.minimumEvidenceJobs || !!(input.period && input.period.partial);
    const globalHigh = !globalLow && paidJobs >= settings.highConfidenceJobs && dataIssues.length === 0;
    const sufficientQuotes = known(metrics.quotesSent) && metrics.quotesSent >= settings.minimumEvidenceQuotes;
    const observed = value => known(value);
    const healthyEconomics = observed(metrics.grossMargin) && metrics.grossMargin >= settings.minGrossMargin && observed(metrics.gpPerCrewDay) && metrics.gpPerCrewDay >= settings.minGpPerCrewDay;
    const economicsCritical = (observed(metrics.grossMargin) && metrics.grossMargin < settings.minGrossMargin) || (observed(metrics.gpPerCrewDay) && metrics.gpPerCrewDay < settings.minGpPerCrewDay) || (observed(metrics.consecutiveLosses) && metrics.consecutiveLosses >= settings.minConsecutiveLosses);
    const lowCapacity = observed(metrics.utilization) && metrics.utilization < settings.lowUtilization;
    const highCapacity = observed(metrics.utilization) && metrics.utilization > settings.highUtilization;
    const highBacklog = observed(metrics.backlogDays) && metrics.backlogDays > settings.maxBacklogDays;
    const lowBacklog = observed(metrics.backlogDays) && metrics.backlogDays <= settings.lowBacklogDays;
    const timingSignal = observed(metrics.timingLossRate) && metrics.timingLossRate >= 0.4 && metrics.lostTiming >= 2;
    const overloaded = highCapacity && (highBacklog || timingSignal);
    const periodWeeks = num(input.metrics?.periodWeeks) > 0 ? input.metrics.periodWeeks : input.period && isDate(input.period.start) && isDate(input.period.end) ? Math.max(1,(Date.parse(input.period.end)-Date.parse(input.period.start)+86400000)/(7*86400000)) : 1;
    const leadTarget = settings.targetQualifiedLeads * periodWeeks;
    const leadsEnough = observed(metrics.qualifiedLeads) && metrics.qualifiedLeads >= leadTarget;
    const leadsLow = observed(metrics.qualifiedLeads) && metrics.qualifiedLeads < leadTarget && !(input.period && input.period.partial);
    const weakClose = observed(metrics.quoteWinRate) && metrics.quoteWinRate < settings.minQuoteWinRate && sufficientQuotes;
    const closeUsable = observed(metrics.quoteWinRate) && metrics.quoteWinRate >= settings.minQuoteWinRate && sufficientQuotes;

    function assessment(key, score, evidence, complete) {
      const advice = ADVICE[key];
      // A risk signal is useful with incomplete data; an incomplete absence of
      // risk is not a green result. Unknown stays visibly unknown.
      if (!complete && known(score) && score < 40) score = null;
      const confidence = score === null || globalLow || !complete ? 'LOW' : globalHigh ? 'HIGH' : 'MEDIUM';
      const explanation = score === null ? 'Pro tuto oblast zatím chybí dostatečná srovnatelná data.' : score < 40 ? 'Doložené ukazatele v této oblasti nyní nepřekračují rizikové prahy.' : !complete ? 'Dostupné ukazatele naznačují možné omezení v oblasti „' + advice.label + '“. Část dat chybí; před placeným krokem ověřte uvedené důkazy a doplňte chybějící údaje.' : advice.explanation;
      return { key, label: advice.label, score, confidence, status: score === null ? 'UNKNOWN' : score >= 75 ? 'RED' : score >= 40 ? 'YELLOW' : 'GREEN', evidence: evidence.filter(Boolean), explanation, action: advice.action, success: advice.success, avoid: advice.avoid.slice() };
    }
    const evidenceValue = (label, value, formatter) => observed(value) ? label + ': ' + (formatter || decimal)(value) : null;
    const constraints = [];
    const demandComplete = [metrics.qualifiedLeads, metrics.utilization, metrics.backlogDays, metrics.quoteWinRate, metrics.grossMargin, metrics.gpPerCrewDay].every(observed) && sufficientQuotes && !(input.period && input.period.partial);
    const demandScore = lowCapacity && lowBacklog && leadsLow && closeUsable && healthyEconomics ? 88 : lowCapacity && leadsLow && !weakClose ? 60 : demandComplete ? 15 : null;
    constraints.push(assessment('DEMAND', demandScore, [evidenceValue('Kvalifikované poptávky', metrics.qualifiedLeads), evidenceValue('Vytížení', metrics.utilization, pct), evidenceValue('Backlog v pracovních dnech', metrics.backlogDays), evidenceValue('Úspěšnost nabídek', metrics.quoteWinRate, pct), evidenceValue('Hrubá marže', metrics.grossMargin, pct)], demandComplete));
    const conversionComplete = [metrics.qualifiedLeads, metrics.quoteWinRate, metrics.utilization].every(observed) && sufficientQuotes;
    const conversionScore = weakClose && leadsEnough && !highCapacity ? 90 : weakClose && !highCapacity ? 72 : conversionComplete && metrics.quoteWinRate < settings.targetQuoteWinRate ? 48 : conversionComplete ? 12 : null;
    constraints.push(assessment('CONVERSION', conversionScore, [evidenceValue('Kvalifikované poptávky', metrics.qualifiedLeads), evidenceValue('Odeslané nabídky', metrics.quotesSent), evidenceValue('Úspěšnost nabídek', metrics.quoteWinRate, pct), evidenceValue('Vytížení', metrics.utilization, pct), !sufficientQuotes ? 'Pro spolehlivější konverzi potřebujeme alespoň ' + settings.minimumEvidenceQuotes + ' nabídek.' : null], conversionComplete));
    const capacityComplete = [metrics.utilization, metrics.backlogDays, metrics.lostTiming, metrics.lostCount].every(observed);
    const capacityScore = overloaded ? 94 : highCapacity || highBacklog || timingSignal ? 78 : capacityComplete && metrics.utilization >= settings.targetUtilization ? 45 : capacityComplete ? 10 : null;
    constraints.push(assessment('CAPACITY', capacityScore, [evidenceValue('Vytížení', metrics.utilization, pct), evidenceValue('Backlog v pracovních dnech', metrics.backlogDays), evidenceValue('Ztracené zakázky kvůli termínu', metrics.lostTiming), evidenceValue('Podíl ztrát kvůli termínu', metrics.timingLossRate, pct)], capacityComplete));
    const economicsComplete = [metrics.grossMargin, metrics.gpPerCrewDay, metrics.consecutiveLosses].every(observed);
    const economicsScore = economicsCritical ? 97 : economicsComplete && metrics.grossMargin < settings.targetGrossMargin ? 60 : economicsComplete ? 10 : null;
    constraints.push(assessment('ECONOMICS', economicsScore, [evidenceValue('Hrubá marže', metrics.grossMargin, pct), evidenceValue('Hrubý zisk', metrics.grossProfit, money), evidenceValue('Zisk na pracovní den', metrics.gpPerCrewDay, money), evidenceValue('Ztrátové zakázky v řadě', metrics.consecutiveLosses)], economicsComplete));
    const cashComplete = cash.fresh && [cash.freeCash,cash.runway,cash.overdueLiabilities].every(known) && cash.unfundedWork !== null;
    const cashScore = cash.status === 'CRITICAL' ? 100 : observed(cash.runway) && cash.runway < settings.minRunway ? 80 : observed(cash.runway) && cash.runway <= settings.healthyRunway ? 50 : cashComplete ? 10 : null;
    constraints.push(assessment('CASH', cashScore, [evidenceValue('Volná hotovost po rezervách', cash.freeCash, money), evidenceValue('Survival runway v týdnech', cash.runway), evidenceValue('Závazky po splatnosti', cash.overdueLiabilities, money), cash.unfundedWork === true ? 'Prodané práce nemají zajištěné financování.' : cash.unfundedWork === false ? 'Financování prodaných prací je potvrzené.' : null], cashComplete));
    const deliveryComplete = [metrics.costVariance, metrics.lateStartRate, metrics.reworkRate].every(observed);
    const deliveryRisk = (observed(metrics.costVariance) && metrics.costVariance > settings.maxCostVariance) || (observed(metrics.lateStartRate) && metrics.lateStartRate > settings.maxLateStartRate) || (observed(metrics.reworkRate) && metrics.reworkRate > settings.maxReworkRate);
    constraints.push(assessment('DELIVERY', deliveryRisk ? 82 : deliveryComplete ? 10 : null, [evidenceValue('Odchylka skutečných nákladů', metrics.costVariance, pct), evidenceValue('Opožděné nástupy', metrics.lateStartRate, pct), evidenceValue('Práce vyžadující opravu', metrics.reworkRate, pct)], deliveryComplete));
    const peopleRelevant = stage.number !== null && stage.number >= 3;
    const peopleComplete = peopleRelevant && observed(metrics.understaffed) && capacityComplete;
    const peopleRisk = peopleRelevant && observed(metrics.understaffed) && metrics.understaffed > 0 && (overloaded || highBacklog);
    constraints.push(assessment('PEOPLE', peopleRisk ? 96 : peopleComplete ? 12 : null, [peopleRelevant ? evidenceValue('Chybějící lidé', metrics.understaffed) : 'Před samostatným týmem není nábor automaticky hlavní páka.', peopleRelevant ? evidenceValue('Vytížení', metrics.utilization, pct) : null, peopleRelevant ? evidenceValue('Backlog v pracovních dnech', metrics.backlogDays) : null], peopleComplete));
    const founderRelevant = stage.number !== null && stage.number >= 2;
    const founderComplete = founderRelevant && observed(metrics.founderDelegationShare);
    const founderRisk = founderComplete && metrics.founderDelegationShare > settings.founderDelegationRatio;
    constraints.push(assessment('FOUNDER_LEVERAGE', founderRisk ? 76 : founderComplete ? 12 : null, [founderRelevant ? evidenceValue('Čas zakladatele', metrics.founderHours) : 'Ve validaci je práce zakladatele v terénu také učením.', founderRelevant ? evidenceValue('Delegovatelný podíl času', metrics.founderDelegationShare, pct) : null], founderComplete));
    const byKey = Object.fromEntries(constraints.map(item => [item.key, item]));
    // Overrides are explicit. Then select the upstream bottleneck instead of
    // treating revenue, a downstream outcome, as its own causal constraint.
    let primary = null;
    if (cash.status === 'CRITICAL') primary = byKey.CASH;
    else if (economicsCritical) primary = byKey.ECONOMICS;
    else if (peopleRisk) primary = byKey.PEOPLE;
    else if (overloaded) primary = byKey.CAPACITY;
    else if (weakClose && leadsEnough && !highCapacity) primary = byKey.CONVERSION;
    else {
      primary = constraints.filter(item => known(item.score) && item.score >= 40).sort((a, b) => b.score - a.score || KEYS.indexOf(a.key) - KEYS.indexOf(b.key))[0] || null;
    }
    const confidence = primary ? primary.confidence : globalHigh && constraints.every(item => item.score !== null || ['PEOPLE', 'FOUNDER_LEVERAGE'].includes(item.key)) ? 'HIGH' : 'LOW';
    return { asOf: isDate(input.asOf) ? input.asOf : null, period: Object.assign({}, input.period || {}), completedPaidJobs: paidJobs, team, stage, metrics, cash, constraints, primary, confidence, dataIssues: unique(dataIssues), settings };
  }

  /** 13 weeks from asOf. Past items are returned as overdue, never silently booked.
   * committed: cash + contractual flows only.
   * expected: independent scenario cash + committed + probability-weighted expected.
   * weeklyBurn is deliberately NOT inserted: scheduled outflows already include payroll
   * and recurring expenses, and inserting burn would double count them.
   * @param {number|object|null} cash @param {Array<object>} items @param {string} asOf
   * @param {object=} customSettings @returns {{weeks:Array<object>,overdue:Array<object>,issues:Array<string>}}
   */
  function forecast(cash, items, asOf, customSettings) {
    const issues = [];
    normalizeSettings(customSettings, issues);
    if (!isDate(asOf)) return { weeks: [], overdue: [], issues: ['Pro výhled je potřeba platné datum YYYY-MM-DD.'] };
    const datedBalanceMismatch = cash && typeof cash === 'object' && Object.prototype.hasOwnProperty.call(cash,'asOf') && cash.asOf !== asOf;
    const bankCash = datedBalanceMismatch ? null : num(cash && typeof cash === 'object' ? cash.bankCash : cash, true);
    if(datedBalanceMismatch)issues.push('Zůstatek není potvrzený ke dni začátku výhledu. Aktualizujte cash snímek; starý zůstatek není dnešní cash.');
    if (bankCash === null) issues.push('Chybí bankovní zůstatek: plánované toky jsou vidět, ale zůstatky nelze určit.');
    const weeks = Array.from({ length: 13 }, (_, index) => ({ week: index + 1, start: addDays(asOf, index * 7), end: addDays(asOf, index * 7 + 6), inflows: 0, outflows: 0, expectedInflows: 0, expectedOutflows: 0, committed: null, expected: null }));
    const overdue = [];
    const accepted = new Map();
    (Array.isArray(items) ? items : []).forEach(function (item, index) {
      if (!item || !text(item.id) || !isDate(item.date) || num(item.amount) === null || !['in', 'out'].includes(item.direction) || !['committed', 'expected'].includes(item.layer) || num(item.probability) === null || item.probability > 1) {
        issues.push('Neplatná položka výhledu ' + (item && text(item.label) || index + 1) + ' byla vynechána.'); return;
      }
      const key = text(item.sourceId) || text(item.id);
      const previous = accepted.get(key);
      if (previous) {
        issues.push('Duplicitní zdroj ' + key + ' je započten pouze jednou; potvrzená vrstva má přednost.');
        if (previous.layer === 'committed' || item.layer !== 'committed') return;
      }
      accepted.set(key, Object.assign({}, item, { amount: item.amount, probability: item.layer === 'committed' ? 1 : item.probability }));
    });
    accepted.forEach(function (item) {
      if (item.date < asOf) { overdue.push(item); return; }
      const index = Math.floor((Date.parse(item.date + 'T00:00:00Z') - Date.parse(asOf + 'T00:00:00Z')) / (86400000 * 7));
      if (index >= 13) return;
      const key = item.layer === 'committed' ? item.direction === 'in' ? 'inflows' : 'outflows' : item.direction === 'in' ? 'expectedInflows' : 'expectedOutflows';
      weeks[index][key] += item.amount * item.probability;
    });
    if(!weeks.some(week=>week.outflows>0))issues.push('Výhled neobsahuje žádné závazné výdaje. Doplňte mzdy, dodavatele a ostatní splatnosti; nulový plán není potvrzením nulových nákladů.');
    if (overdue.length) issues.push(overdue.length + ' položek je před datem výhledu. Vyřešte jejich stav nebo zadejte nové očekávané datum; nejsou přičteny k dnešní hotovosti.');
    let committedBalance = bankCash;
    let expectedBalance = bankCash;
    weeks.forEach(function (week) {
      const committedChange = week.inflows - week.outflows;
      if (known(committedBalance)) committedBalance = finite(committedBalance + committedChange);
      if (known(expectedBalance)) expectedBalance = finite(expectedBalance + committedChange + week.expectedInflows - week.expectedOutflows);
      week.committed = committedBalance;
      week.expected = expectedBalance;
    });
    return { weeks, overdue, issues: unique(issues) };
  }

  /** Evaluate a proposal without guessing intent from its title. Revenue uplift is
   * multiplied by current observed gross margin; recurring cost is deducted once.
   * Free cash reserves the first new monthly commitment; runway includes recurring
   * cost in weekly burn, not in the numerator too. Unproven revenue is never runway.
   * @param {object} decision @param {object} state @param {object=} customSettings
   */
  function evaluateDecision(decision, state, customSettings) {
    decision = decision || {};
    state = state || {};
    const settings = normalizeSettings(customSettings || state.settings);
    const oneTimeCost = num(decision.oneTimeCost);
    const monthlyCost = num(decision.monthlyCost);
    const revenueImpact = num(decision.monthlyRevenueImpact, true);
    const savings = num(decision.monthlySavings, true);
    const capacityHours = num(decision.capacityHours, true);
    const founderHours = num(decision.founderHours);
    const feedbackDays = num(decision.feedbackDays);
    const reversibility = Number.isInteger(decision.reversibility) && decision.reversibility >= 1 && decision.reversibility <= 5 ? decision.reversibility : null;
    const evidence = ['guess', 'anecdotal', 'test', 'historical', 'strong'].includes(decision.evidence) ? decision.evidence : null;
    const stageNumber = state.stage && state.stage.number;
    const cash = state.cash || {};
    const metric = text(decision.metric);
    const cheaperTest = text(decision.cheaperTest);
    const target = KEYS.includes(decision.targetConstraint) ? decision.targetConstraint : null;
    const primary = state.primary && state.primary.key;
    const flags = [];
    const reasons = [];
    const reconsider = [];
    const mapping = {
      hiring: ['CAPACITY', 'PEOPLE', 'FOUNDER_LEVERAGE', 'DELIVERY'], marketing: ['DEMAND'],
      capex: ['CAPACITY', 'ECONOMICS', 'DELIVERY'], expansion: ['DEMAND', 'CAPACITY'],
      pricing: ['ECONOMICS', 'CONVERSION'], service: ['DEMAND', 'ECONOMICS'],
      software: ['FOUNDER_LEVERAGE', 'CONVERSION', 'CAPACITY', 'DELIVERY', 'ECONOMICS'],
      finance: ['CASH', 'ECONOMICS'], other: KEYS
    };
    const type = Object.prototype.hasOwnProperty.call(mapping, decision.type) ? decision.type : null;
    const numericImpact = target === 'CAPACITY' || target === 'PEOPLE' ? known(capacityHours) && capacityHours > 0 : target === 'DEMAND' || target === 'CONVERSION' ? known(revenueImpact) && revenueImpact > 0 : target === 'ECONOMICS' || target === 'CASH' ? (known(savings) && savings > 0) || (known(revenueImpact) && revenueImpact > 0) : (known(savings) && savings > 0) || (known(capacityHours) && capacityHours > 0);
    let constraintFit = 'UNKNOWN';
    if (primary && target && type) constraintFit = target !== primary || !mapping[type].includes(primary) ? 'NO' : metric && numericImpact ? 'YES' : 'PARTLY';
    let stageFit = known(stageNumber) ? 'YES' : 'UNKNOWN';
    if (type === 'expansion' && known(stageNumber) && stageNumber < 3) { stageFit = 'NO'; flags.push('PREMATURE_OPTIMIZATION'); reasons.push('Expanze před doloženou opakovatelností a samostatným týmem je předčasná optimalizace.'); reconsider.push('Až funguje samostatný tým, opakovatelná marže a ověřená poptávka v nové lokalitě.'); }
    if (type === 'expansion' && stageNumber === 3) stageFit = 'PARTLY';
    if (type === 'software' && stageNumber === 1 && (!target || !metric || !cheaperTest || !known(feedbackDays) || feedbackDays > settings.maxFeedbackDays)) {
      flags.push('LIKELY_PRODUCTIVE_PROCRASTINATION');
      reasons.push('V první fázi musí nový nástroj změnit konkrétní měření nebo rozhodnutí do ' + settings.maxFeedbackDays + ' dní. Chybí rychle ověřitelný účel nebo levnější test.');
      reconsider.push('Doplňte aktuální constraint, jednu metriku, zpětnou vazbu do ' + settings.maxFeedbackDays + ' dní a levnější způsob ověření.');
    }
    const remainingFreeCash = known(cash.freeCash) ? minus(cash.freeCash, sum([oneTimeCost, monthlyCost])) : null;
    const runwayBefore = num(cash.runway, true);
    const survivalCash = known(cash.survivalCash) ? cash.survivalCash : known(cash.bankCash) ? minus(cash.bankCash, sum([num(cash.taxReserve), num(cash.committedPayables), num(cash.customerAdvanceReserve)])) : null;
    const afterBurn = known(cash.weeklyBurn) && known(monthlyCost) ? cash.weeklyBurn + monthlyCost * 12 / 52 : null;
    const afterSurvivalCash = minus(survivalCash, oneTimeCost);
    const runwayAfter = ratio(known(afterSurvivalCash) ? Math.max(0, afterSurvivalCash) : null, afterBurn);
    const grossMargin = state.metrics && num(state.metrics.grossMargin, true);
    const incrementalRevenueProfit = revenueImpact === 0 ? 0 : known(revenueImpact) && known(grossMargin) ? finite(revenueImpact * grossMargin) : null;
    const incrementalMonthlyGrossProfit = known(incrementalRevenueProfit) && known(savings) && known(monthlyCost) ? finite(incrementalRevenueProfit + savings - monthlyCost) : null;
    const paybackMonths = known(incrementalMonthlyGrossProfit) && incrementalMonthlyGrossProfit > 0 ? ratio(oneTimeCost, incrementalMonthlyGrossProfit) : null;
    const cashUnsafe = cash.status === 'CRITICAL' || (known(remainingFreeCash) && remainingFreeCash < 0) || (known(runwayAfter) && runwayAfter < settings.minCriticalRunway);
    const essentialUnknown = cash.fresh !== true || cash.status === 'UNKNOWN' || !text(decision.title) || !type || oneTimeCost === null || monthlyCost === null || founderHours === null || feedbackDays === null || reversibility === null || evidence === null || !metric || !target || !primary || !known(stageNumber) || remainingFreeCash === null || runwayAfter === null;
    if (constraintFit === 'NO') { reasons.push('Zadaný dopad neřeší aktuální hlavní omezení ' + primary + '.'); reconsider.push('Až se hlavní omezení změní nebo bude prokázán přímý dopad na ' + primary + '.'); }
    else if (constraintFit === 'YES') reasons.push('Rozhodnutí má explicitní vazbu na ' + primary + ' a měřitelný očekávaný dopad.');
    else if (constraintFit === 'PARTLY') reasons.push('Záměr míří na správné omezení, ale číselný dopad nebo měření není doloženo.');
    if (cashUnsafe) { flags.push('CASH_RISK'); reasons.push('Po prvním výdaji a rezervaci nové měsíční platby zbývá ' + money(remainingFreeCash) + '; runway po rozhodnutí je ' + decimal(runwayAfter) + ' týdne.'); reconsider.push('Až výdaj zachová nezápornou volnou hotovost a runway alespoň ' + settings.minRunway + ' týdnů.'); }
    if (known(monthlyCost) && monthlyCost > 0) reasons.push('Nový závazek zvyšuje měsíční fixní náklady o ' + money(monthlyCost) + '.');
    if (known(incrementalMonthlyGrossProfit) && incrementalMonthlyGrossProfit <= 0) { flags.push('NON_POSITIVE_RETURN'); reasons.push('Očekávaný měsíční přírůstek hrubého zisku po nových nákladech není kladný.'); }
    if (known(paybackMonths) && paybackMonths > settings.maxPaybackMonths) { flags.push('SLOW_PAYBACK'); reasons.push('Odhad návratnosti ' + decimal(paybackMonths) + ' měsíců překračuje limit ' + settings.maxPaybackMonths + '.'); }
    if (reversibility !== null && reversibility <= 2) { flags.push('HARD_TO_REVERSE'); reasons.push('Rozhodnutí je obtížné nebo nákladné vrátit zpět.'); }
    if (evidence === 'guess' || evidence === 'anecdotal') { flags.push('WEAK_EVIDENCE'); reasons.push('Dopad zatím stojí na předpokladu; nejdříve ověřte levný test.'); }
    if (essentialUnknown) { flags.push('MISSING_DATA'); reasons.push('Pro bezpečné schválení chybí část zadání, hlavní omezení nebo aktuálně ověřená volná hotovost a runway.'); }
    let verdict;
    if (cashUnsafe || stageFit === 'NO' || constraintFit === 'NO' || flags.includes('LIKELY_PRODUCTIVE_PROCRASTINATION')) verdict = 'WAIT';
    else if (essentialUnknown) verdict = 'NEED_DATA';
    else if (constraintFit !== 'YES' || stageFit === 'PARTLY' || !['historical', 'strong'].includes(evidence) || reversibility <= 2 || feedbackDays > settings.maxFeedbackDays || flags.includes('SLOW_PAYBACK') || flags.includes('NON_POSITIVE_RETURN') || incrementalMonthlyGrossProfit === null || (known(runwayAfter) && runwayAfter < settings.minRunway)) verdict = 'TEST';
    else verdict = 'DO';
    if (!reconsider.length) reconsider.push('Vyhodnoťte metriku „' + metric + '“ po ' + decimal(feedbackDays) + ' dnech a porovnejte skutečný dopad s odhadem.');
    const betterMove = cheaperTest || (state.primary && state.primary.action) || 'Doplňte skutečnou ekonomiku zakázek, oddělené rezervy a důvod současného omezení.';
    return { verdict, reasons, constraintFit, stageFit, flags: unique(flags), remainingFreeCash, runwayBefore, runwayAfter, incrementalMonthlyGrossProfit, paybackMonths, betterMove, reconsider: unique(reconsider), assumptions: ['Přírůstek tržeb používá současnou hrubou marži; nejde o zaručený výsledek.', 'Runway nezapočítává očekávané nové tržby ani neověřené úspory.', 'Volná hotovost rezervuje první novou měsíční platbu; runway počítá novou měsíční platbu průběžně v burnu.'] };
  }

  /** One objective, one falsifiable experiment and at most three actions. */
  function weeklyPlan(state) {
    state = state || {};
    const settings = normalizeSettings(state.settings);
    const primary = state.primary;
    if (!primary) return {
      objective: 'Doložit všech 5 hlavních ukazatelů: marži, konverzi, vytížení, volnou hotovost a runway.',
      experiment: { hypothesis: 'Srovnatelná data ukážou, zda firmu brzdí prodej, realizace, ekonomika nebo cash.', action: 'Doplnit skutečné náklady, odpracované hodiny, obchodní výsledky a oddělené rezervy za jedno celé období.', budget: 0, metric: 'Počet doložených hlavních ukazatelů', successValue: 5, comparison: 'gte', successThreshold: 'Lze spočítat marži, konverzi, vytížení, volnou hotovost a runway.' },
      actions: ['Zkontrolovat období a stav původních zakázek.', 'Doplnit chybějící skutečnost a potvrdit i nulové rezervy.', 'Spustit diagnózu a zvolit jeden měřitelný test.'],
      avoid: ['Nedělat nevratnou investici na základě chybějících dat.']
    };
    const settingsMoney = state.cash && state.cash.fresh === true && !['UNKNOWN','CRITICAL'].includes(state.cash.status) && known(state.cash.freeCash) && state.cash.freeCash > 0 && known(state.cash.runway) && state.cash.runway >= settings.minRunway ? Math.floor(Math.min(settings.experimentBudget, state.cash.freeCash * settings.maxExperimentCashFraction)) : 0;
    const plans = {
      DEMAND: { objective: 'Získat kvalifikované poptávky pro volnou kapacitu.', hypothesis: 'Jeden cílený zdroj přivede nové kvalifikované poptávky při zachování ekonomiky.', action: settingsMoney > 0 ? 'Spustit malý test jednoho reklamního zdroje a označit každou příchozí poptávku.' : 'Oslovit předchozí kontakty a partnery; zaznamenat zdroj každé kvalifikované poptávky.', budget: settingsMoney, metric: 'Kvalifikované poptávky z testu', successThreshold: 'Alespoň ' + settings.minimumExperimentLeads + ' kvalifikovaných poptávek během 7 dní.', actions: ['Vybrat jeden zdroj a jednu nabídku.', 'Každý den zaznamenat kvalifikované poptávky a odeslané nabídky.', 'Za týden vyhodnotit počet, cenu a kvalitu poptávek.'] },
      CONVERSION: { objective: 'Zvýšit podíl vyhraných nabídek bez snížení minimální marže.', hypothesis: 'Rychlejší reakce a cílený follow-up odstraní jeden opakovaný důvod ztráty.', action: 'Na dalších pěti nabídkách otestovat stejný postup reakce a follow-up.', budget: 0, metric: 'Úspěšnost nabídek testovací skupiny', successThreshold: 'Alespoň ' + pct(settings.targetQuoteWinRate) + ' při marži nejméně ' + pct(settings.minGrossMargin) + '; otevřené nabídky hodnotit až po uzavření.', actions: ['Zjistit důvody posledních pěti ztrát.', 'Otestovat jeden nový postup na pěti nabídkách.', 'Zapsat výhry, ztráty a zbývající otevřené nabídky.'] },
      CAPACITY: { objective: 'Zkrátit čekání na realizaci při zachování zisku.', hypothesis: 'Dočasná posila nebo lepší pořadí prací uvolní dostupné hodiny.', action: 'Otestovat změnu plánování na pěti zakázkách; posilu nejprve ocenit přes rozhodovací formulář.', budget: 0, metric: 'Backlog v pracovních dnech', successThreshold: 'Backlog nejvýše ' + settings.maxBacklogDays + ' dní a zisk na pracovní den alespoň ' + money(settings.minGpPerCrewDay) + '.', actions: ['Zmapovat příštích deset pracovních dní.', 'Přesunout jeden konkrétní blokující úkol.', 'Porovnat dodané hodiny, backlog a skutečnou marži.'] },
      ECONOMICS: { objective: 'Zastavit opakování zakázek pod ekonomickým minimem.', hypothesis: 'Opravený odhad hlavního nákladu zlepší ziskovost nových zakázek.', action: 'Rozebrat poslední tři dokončené zakázky a otestovat novou kalkulaci na dalších třech nabídkách.', budget: 0, metric: 'Hrubá marže a zisk na pracovní den', successThreshold: 'Marže alespoň ' + pct(settings.minGrossMargin) + ' a zisk na pracovní den alespoň ' + money(settings.minGpPerCrewDay) + '.', actions: ['Porovnat odhad a skutečné náklady i hodiny.', 'Opravit jednu největší položku kalkulace.', 'Zapsat nabídky a později skutečný výsledek nových zakázek.'] },
      CASH: { objective: 'Zajistit nejbližší závazky a financování prodaných prací.', hypothesis: 'Konkrétní plán inkasa a termínů plateb odstraní nejbližší mezeru v hotovosti.', action: 'Prověřit pohledávky a splatnosti; sestavit potvrzený plán na 13 týdnů.', budget: 0, metric: 'Volná hotovost a survival runway', successThreshold: 'Volná hotovost alespoň 0 Kč, runway alespoň ' + settings.minCriticalRunway + ' týdny a žádná prodaná práce bez financování.', actions: ['Potvrdit oddělené rezervy a nejbližší splatné závazky.', 'Vyžádat konkrétní datum platby od dlužníků.', 'Odložit volitelné výdaje a znovu vyhodnotit krytí.'] },
      DELIVERY: { objective: 'Odstranit jednu opakovanou chybu realizace.', hypothesis: 'Jedna kontrola před zahájením zabrání opakované odchylce nebo opravě.', action: 'Na dalších třech zakázkách použít stejný předávací checklist.', budget: 0, metric: 'Podíl oprav a opožděných nástupů', successThreshold: 'Opravy nejvýše ' + pct(settings.maxReworkRate) + ', zpoždění nejvýše ' + pct(settings.maxLateStartRate) + '.', actions: ['Vybrat jednu nejčastější doloženou chybu.', 'Přidat kontrolu předání a odpovědného člověka.', 'Porovnat další tři zakázky se skutečností.'] },
      PEOPLE: { objective: 'Ověřit, zda konkrétní posila uvolní přetížený tým.', hypothesis: 'Jasně vymezená a zaškolená role zvýší dodané hodiny bez propadu marže.', action: 'Vymezit jednu roli a připravit krátký placený test; cenu schválit samostatným rozhodnutím.', budget: 0, metric: 'Dodané hodiny a zisk na pracovní den', successThreshold: 'Více dodaných hodin, backlog nejvýše ' + settings.maxBacklogDays + ' dní a zisk na pracovní den alespoň ' + money(settings.minGpPerCrewDay) + '.', actions: ['Popsat výsledek role a plán zaškolení.', 'Ocenit a posoudit omezený test posily.', 'Po testu změřit hodiny, kvalitu a hrubý zisk.'] },
      FOUNDER_LEVERAGE: { objective: 'Předat jeden opakovaný úkol a uvolnit zakladateli čas.', hypothesis: 'Checklist a odpovědnost umožní předání úkolu bez zhoršení výsledku.', action: 'Jeden týden předat jeden opakovaný úkol a měřit čas i opravy.', budget: 0, metric: 'Podíl delegovatelného času zakladatele', successThreshold: 'Podíl klesne pod ' + pct(settings.founderDelegationRatio) + ' bez zhoršení kvality předaného výstupu.', actions: ['Vybrat jeden opakovaný delegovatelný úkol.', 'Sepsat definici hotového výsledku a předat jej.', 'Změřit uvolněné hodiny a využít je na aktuální obchodní prioritu.'] }
    };
    const plan = plans[primary.key];
    const measurements={
      DEMAND:[settings.minimumExperimentLeads,'gte','Kvalifikované poptávky z testu'],
      CONVERSION:[settings.targetQuoteWinRate*100,'gte','Konverze testovacích nabídek (%)'],
      CAPACITY:[settings.maxBacklogDays,'lte','Backlog (pracovní dny)'],
      ECONOMICS:[settings.minGrossMargin*100,'gte','Hrubá marže (%)'],
      CASH:[0,'gte','Volná hotovost (Kč)'],
      DELIVERY:[settings.maxReworkRate*100,'lte','Podíl oprav (%)'],
      PEOPLE:[settings.maxBacklogDays,'lte','Backlog (pracovní dny)'],
      FOUNDER_LEVERAGE:[settings.founderDelegationRatio*100,'lte','Delegovatelný podíl času (%)']
    };
    const [successValue,comparison,metric]=measurements[primary.key];
    return { objective: plan.objective + ' Cíl: ' + plan.successThreshold, experiment: { hypothesis: plan.hypothesis, action: plan.action, budget: plan.budget, metric, successValue, comparison, successThreshold: plan.successThreshold }, actions: plan.actions.slice(0, 3), avoid: primary.avoid.slice() };
  }

  function evaluateExperiment(input){
    if(!input||!known(input.result)||!known(input.successThreshold)||!['gte','lte'].includes(input.comparison))return 'INCONCLUSIVE';
    const reached=input.comparison==='lte'?input.result<=input.successThreshold:input.result>=input.successThreshold;
    if(!reached||input.conditionsMet===false)return 'INVALIDATED';
    return input.conditionsMet===true?'VALIDATED':'INCONCLUSIVE';
  }

  const AI_FIELDS = ['interpretation', 'facts', 'assumptions', 'primaryMove', 'actions', 'avoid', 'questions'];
  /** Strict explanation-only schema: financial/numeric fields from AI are rejected. */
  function validateAIResponse(value) {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['Odpověď musí být JSON objekt.'], value: null };
    Object.keys(value).forEach(key => { if (!AI_FIELDS.includes(key)) errors.push('Nepovolené pole: ' + key + '.'); });
    ['interpretation', 'primaryMove'].forEach(key => { if (!text(value[key]) || value[key].length > 3000) errors.push(key + ' musí být neprázdný text do 3000 znaků.'); });
    ['facts', 'assumptions', 'actions', 'avoid', 'questions'].forEach(function (key) {
      const limit = key === 'actions' || key === 'questions' ? 3 : 8;
      if (!Array.isArray(value[key]) || value[key].length > limit || value[key].some(item => typeof item !== 'string' || !text(item) || item.length > 1500)) errors.push(key + ' musí být seznam nejvýše ' + limit + ' neprázdných textů.');
    });
    if (Array.isArray(value.actions) && value.actions.length === 0) errors.push('actions musí obsahovat alespoň jeden krok.');
    return { valid: errors.length === 0, errors, value: errors.length ? null : Object.fromEntries(AI_FIELDS.map(key => [key, Array.isArray(value[key]) ? value[key].slice() : value[key]])) };
  }

  /** Optional provider: async function(payload) or {interpret: async function(payload)}.
   * The provider receives only deterministic state, no raw client/job database.
   * Rule fallback always works offline and never applies AI output as numeric state.
   */
  async function interpret(state, provider) {
    state = state || {};
    const plan = weeklyPlan(state);
    const fallback = {
      source: 'rules', interpretation: state.primary ? state.primary.explanation : 'Data zatím neukazují jedno dostatečně doložené hlavní omezení. Nejprve ověřte chybějící podklady.',
      facts: state.primary ? state.primary.evidence.slice() : [],
      assumptions: ['Diagnóza je vysvětlitelná heuristika; obchodní dopad navrženého testu je hypotéza.'],
      primaryMove: plan.experiment.action, actions: plan.actions.slice(0, 3), avoid: plan.avoid.slice(), questions: [], validationErrors: []
    };
    if (!provider) return fallback;
    const fn = typeof provider === 'function' ? provider : typeof provider.interpret === 'function' ? provider.interpret.bind(provider) : null;
    if (!fn) return Object.assign({}, fallback, { validationErrors: ['AI provider nemá funkci interpret.'] });
    const payload = JSON.parse(JSON.stringify({ stage: state.stage, constraint: state.primary, confidence: state.confidence, metrics: state.metrics, cash: state.cash, dataIssues: state.dataIssues, weeklyPlan: plan, instructions: 'Vysvětli pouze doložený stav. Neměň constraint, nepočítej finanční matematiku. Odděl facts od assumptions. Jedna primaryMove, 1–3 actions. Vrať pouze pole interpretation, facts, assumptions, primaryMove, actions, avoid, questions.' }));
    try {
      const response = await fn(payload);
      const validation = validateAIResponse(response);
      return validation.valid ? Object.assign({ source: 'ai', validationErrors: [] }, validation.value) : Object.assign({}, fallback, { validationErrors: validation.errors });
    } catch (error) {
      return Object.assign({}, fallback, { validationErrors: ['AI interpretace není dostupná; použita lokální pravidla.'] });
    }
  }

  return Object.freeze({ defaults, analyze, evaluateDecision, forecast, weeklyPlan, evaluateExperiment, validateAIResponse, interpret });
});
