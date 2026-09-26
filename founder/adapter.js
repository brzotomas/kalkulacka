(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FounderAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const DAY = 86400000;
  const WON = new Set(["domluveno", "probíhá", "hotovo"]);
  const CASH_FIELDS = ["bankCash", "taxReserve", "payrollReserve", "committedPayables", "customerAdvanceReserve", "weeklyBurn", "overdueLiabilities", "unfundedWork"];
  const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
  const nonnegative = value => number(value) !== null && value >= 0 ? value : null;
  const array = value => Array.isArray(value) ? value : [];
  const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(value + "T12:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  function today() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  const addDays = (iso, days) => new Date(new Date(iso + "T12:00:00Z").getTime() + days * DAY).toISOString().slice(0, 10);
  function monday(iso) {
    const day = new Date(iso + "T12:00:00Z").getUTCDay();
    return addDays(iso, -(day === 0 ? 6 : day - 1));
  }
  function workdays(start, end) {
    if (!start || !end || end < start) return 0;
    const days = Math.round((new Date(end + "T12:00:00Z") - new Date(start + "T12:00:00Z")) / DAY) + 1;
    const full = Math.floor(days / 7);
    let result = full * 5;
    const first = new Date(start + "T12:00:00Z").getUTCDay();
    for (let i = 0; i < days % 7; i++) if ((first + i) % 7 !== 0 && (first + i) % 7 !== 6) result++;
    return result;
  }
  function defaults(existingSettings) {
    const existing = object(existingSettings);
    return {
      version: 1,
      settings: { standardWorkdayHours: nonnegative(existing.standardWorkdayHours) > 0 ? existing.standardWorkdayHours : 8, quoteProbability: 0.3 },
      cash: { bankCash: null, taxReserve: null, payrollReserve: null, committedPayables: null, customerAdvanceReserve: null, weeklyBurn: null, overdueLiabilities: null, unfundedWork: null, asOf: "" },
      team: { independent: false, crews: 1, locations: 1, national: false },
      weeklyInputs: [], forecastItems: [], decisions: [], reviews: [], snapshots: [], experiments: [], memory: [], jobFacts: {}
    };
  }
  function fillAbsent(target, template) {
    for (const key of Object.keys(template)) {
      if (target[key] === undefined) target[key] = Array.isArray(template[key]) ? [] : template[key] && typeof template[key] === "object" ? fillAbsent({}, template[key]) : template[key];
      else if (template[key] && typeof template[key] === "object" && !Array.isArray(template[key]) && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) fillAbsent(target[key], template[key]);
    }
    return target;
  }
  function ensure(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new TypeError("Stav aplikace musí být objekt.");
    if (state.founderOs === undefined || state.founderOs === null) state.founderOs = defaults();
    else if (typeof state.founderOs === "object" && !Array.isArray(state.founderOs)) fillAbsent(state.founderOs, defaults());
    return state.founderOs;
  }
  function jobRevenue(job) {
    const actual = nonnegative(object(job.founder).actualRevenue);
    if (actual !== null) return actual;
    const saved = nonnegative(job.vysCelkem);
    if (saved === null) return null;
    const vat = String(job.dph) === "12" ? 1.12 : String(job.dph) === "21" ? 1.21 : 1;
    return saved / vat;
  }
  function jobActualHours(job) {
    if (nonnegative(job.skutHodiny) > 0) return job.skutHodiny;
    const entries = array(job.denniZapis);
    if (!entries.length) return null;
    if (entries.some(row => nonnegative(row.hodiny) === null || nonnegative(row.lide) === null || row.lide < 1)) return null;
    return entries.reduce((sum, row) => sum + row.hodiny * row.lide, 0);
  }
  function buildInput(state, options) {
    const S = object(state), opts = object(options), asOf = date(opts.asOf) || today();
    const base = defaults(), stored = object(S.founderOs);
    const founder = { ...base, ...stored, settings: { ...base.settings, ...object(stored.settings) }, team: { ...base.team, ...object(stored.team) }, cash: { ...base.cash, ...object(stored.cash) } };
    const jobs = array(S.zakazky).filter(job => job && typeof job === "object");
    const dataIssues = [];
    const issue = text => { if (!dataIssues.includes(text)) dataIssues.push(text); };
    const rawWeeks = array(founder.weeklyInputs).filter(row => row && typeof row === "object");
    const weekMap = new Map();
    for (const row of rawWeeks) {
      if (!date(row.week) || monday(row.week) !== row.week) { issue("Týdenní vstup bez platného pondělního data byl vynechán."); continue; }
      if (weekMap.has(row.week)) issue("Duplicitní týdenní vstup: " + row.week + ". Použit poslední záznam.");
      weekMap.set(row.week, row);
    }
    const selectedPeriod = ["week", "previous", "4weeks", "13weeks", "all"].includes(opts.period) ? opts.period : "week";
    const currentMonday = monday(asOf);
    let start = currentMonday, end = addDays(currentMonday, 6), label = "Tento týden";
    if (selectedPeriod === "previous") { start = addDays(start, -7); end = addDays(start, 6); label = "Minulý týden"; }
    if (selectedPeriod === "4weeks" || selectedPeriod === "13weeks") { const count = selectedPeriod === "4weeks" ? 4 : 13; start = addDays(start, -(count - 1) * 7); label = "Poslední " + count + " týdny"; }
    if (selectedPeriod === "all") {
      const knownDates = [asOf, ...weekMap.keys()];
      for (const job of jobs) { const f = object(job.founder); for (const key of ["leadDate", "quoteDate", "wonDate", "completedDate"]) if (date(f[key]) && f[key] <= asOf) knownDates.push(f[key]); }
      start = monday(knownDates.filter(d => d <= asOf).sort()[0]); end = asOf; label = "Celá historie";
    }
    const inPeriod = value => date(value) && value >= start && value <= end && value <= asOf;
    const period = { start, end, label, partial: selectedPeriod !== "previous" && end > asOf };
    const weeklyCoverage = [];
    // A bounded loop protects corrupted backup dates from blocking the application.
    let weekCount = 0;
    for (let week = monday(start); week <= end && weekCount < 5200; week = addDays(week, 7), weekCount++) {
      const overlapStart = week > start ? week : start;
      const overlapEnd = addDays(week, 6) < end ? addDays(week, 6) : end;
      const fraction = workdays(overlapStart, overlapEnd) / 5;
      if (fraction > 0) weeklyCoverage.push({ week, row: weekMap.get(week), fraction });
    }
    if (weekCount >= 5200) issue("Období přesahuje 100 let; zkontroluj data importu.");
    const sumWeekly = (key, scale) => {
      if (!weeklyCoverage.length || weeklyCoverage.some(item => !item.row || nonnegative(item.row[key]) === null)) return null;
      return weeklyCoverage.reduce((sum, item) => sum + item.row[key] * (scale ? item.fraction : 1), 0);
    };
    const qualifiedLeads = sumWeekly("qualifiedLeads", false);
    const availableHours = sumWeekly("availableHours", true);
    const founderHours = sumWeekly("founderHours", true);
    const founderDelegatableHours = sumWeekly("founderDelegatableHours", true);
    const understaffed = weeklyCoverage.length && weeklyCoverage.every(item => item.row && typeof item.row.understaffed === "boolean") ? weeklyCoverage.some(item => item.row.understaffed) : null;
    if (qualifiedLeads === null) issue("Chybí kvalifikované poptávky v části vybraného období; doplň týdenní vstupy.");
    if (availableHours === null) issue("Chybí dostupné osobohodiny v části vybraného období; vytížení nelze spolehlivě určit.");
    if (founderHours === null || founderDelegatableHours === null) issue("Chybí úplné týdenní údaje o čase majitele a delegovatelných hodinách.");
    if (weeklyCoverage.some(item => item.row && nonnegative(item.row.founderDelegatableHours) !== null && nonnegative(item.row.founderHours) !== null && item.row.founderDelegatableHours > item.row.founderHours)) issue("Delegovatelné hodiny převyšují celkový čas majitele; oprav týdenní vstup.");
    const datedQuotes = jobs.filter(job => inPeriod(object(job.founder).quoteDate));
    const incompleteQuotes = jobs.some(job => (WON.has(job.status)||job.status==='zamítnuto') && !date(object(job.founder).quoteDate));
    const quotesSent = incompleteQuotes ? null : jobs.length || qualifiedLeads !== null ? datedQuotes.length : null;
    const wonQuotes = quotesSent === null ? null : datedQuotes.filter(job => WON.has(job.status) && (!date(object(job.founder).wonDate) || object(job.founder).wonDate <= asOf)).length;
    const jobsWon = jobs.some(job => WON.has(job.status) && !date(object(job.founder).wonDate)) ? null : jobs.length || qualifiedLeads !== null ? jobs.filter(job => WON.has(job.status) && inPeriod(object(job.founder).wonDate)).length : null;
    if (jobs.some(job => WON.has(job.status) && !date(object(job.founder).wonDate))) issue("Některé získané zakázky nemají datum získání; nejsou zahrnuty do počtu nově získaných zakázek v období.");
    if (jobs.some(job => !date(object(job.founder).quoteDate))) issue("Zakázky bez data odeslání se nepočítají mezi odeslané nabídky; výchozí stav nabídka může být koncept.");
    const allCompleted = jobs.filter(job => job.status === "hotovo");
    const undatedCompleted = allCompleted.filter(job => !date(object(job.founder).completedDate));
    const completed = allCompleted.filter(job => selectedPeriod === "all" && !date(object(job.founder).completedDate) || inPeriod(object(job.founder).completedDate));
    if (undatedCompleted.length) issue(undatedCompleted.length + " hotových zakázek nemá datum dokončení. " + (selectedPeriod === "all" ? "Zahrnuty pouze v celé historii." : "Ve vybraném období jsou vynechány."));
    if (allCompleted.some(job => date(object(job.founder).completedDate) > asOf)) issue("Hotová zakázka má datum dokončení v budoucnosti a nebyla započtena.");
    const hasBusinessEvidence = jobs.length > 0 || qualifiedLeads !== null;
    function sumCompleted(getValue) {
      if(selectedPeriod !== 'all' && undatedCompleted.length)return null;
      if (!completed.length) return hasBusinessEvidence && !undatedCompleted.length ? 0 : null;
      const values = completed.map(getValue);
      return values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
    }
    const revenue = sumCompleted(jobRevenue);
    const directCosts = sumCompleted(job => nonnegative(object(job.founder).actualDirectCosts));
    const estimatedDirectCosts = sumCompleted(job => {
      if (nonnegative(job.vysNaklady) !== null) return job.vysNaklady;
      const gross = nonnegative(job.vysCelkem), profit = number(job.vysZisk);
      if (gross === null || profit === null) return null;
      const vat = String(job.dph) === '12' ? 1.12 : String(job.dph) === '21' ? 1.21 : 1;
      return nonnegative(gross / vat - profit);
    });
    const actualHours = sumCompleted(jobActualHours);
    const actualCostJobs = completed.filter(job => nonnegative(object(job.founder).actualDirectCosts) !== null).length;
    const actualRevenueJobs = completed.filter(job => nonnegative(object(job.founder).actualRevenue) !== null).length;
    const actualHourJobs = completed.filter(job => jobActualHours(job) !== null).length;
    if (completed.length > actualCostJobs) issue("Skutečné přímé náklady jsou vyplněny u " + actualCostJobs + " z " + completed.length + " hotových zakázek; marže zůstává neznámá.");
    if (completed.length > actualRevenueJobs) issue("Výnos u " + (completed.length - actualRevenueJobs) + " hotových zakázek vychází z uložené sjednané ceny bez DPH, nikoli z ověřeného skutečného výnosu.");
    if (completed.length > actualHourJobs) issue("Skutečné osobohodiny jsou vyplněny u " + actualHourJobs + " z " + completed.length + " hotových zakázek.");
    const lossesByDate = allCompleted.filter(job => date(object(job.founder).completedDate) && object(job.founder).completedDate <= asOf).slice().sort((a, b) => object(b.founder).completedDate.localeCompare(object(a.founder).completedDate));
    let consecutiveLosses = undatedCompleted.length || !lossesByDate.length ? null : 0;
    if (consecutiveLosses !== null) {
      for (const job of lossesByDate) {
        const costs = nonnegative(object(job.founder).actualDirectCosts), netRevenue = jobRevenue(job);
        if (costs === null || netRevenue === null) {
          if (consecutiveLosses === 0) consecutiveLosses = null;
          else issue("Série ztrát zachycuje nejméně " + consecutiveLosses + " posledních zakázek; starší výsledek není ověřený.");
          break;
        }
        if (netRevenue - costs >= 0) break;
        consecutiveLosses++;
      }
    }
    const lost = datedQuotes.filter(job => job.status === "zamítnuto");
    const lostCount = quotesSent === null ? null : lost.length;
    const lostTiming = lostCount === null ? null : lost.filter(job => job.duvodProhry === "Nevyhovoval termín").length;
    const completeDates = selectedPeriod === 'all' || undatedCompleted.length === 0;
    const lateStartRate = completeDates && completed.length && completed.every(job => typeof object(job.founder).onTimeStart === "boolean") ? completed.filter(job => !job.founder.onTimeStart).length / completed.length : null;
    const reworkRate = completeDates && completed.length && actualHours > 0 && completed.every(job => nonnegative(object(job.founder).reworkHours) !== null) ? completed.reduce((sum, job) => sum + job.founder.reworkHours, 0) / actualHours : null;
    const paidCompleted = allCompleted.filter(job => {
      if (date(object(job.founder).completedDate) && object(job.founder).completedDate > asOf) return false;
      const dueTotal = nonnegative(job.vysCelkem);
      if (dueTotal === null || dueTotal <= 0) return false;
      const parts = [[job.zalohaCastka, job.zalohaZaplaceno], [job.doplatekCastka, job.doplatekZaplaceno]];
      const sum = parts.reduce((total, part) => total + (nonnegative(part[0]) || 0), 0);
      return Math.abs(sum - dueTotal) <= 1 && parts.every(([amount, paid]) => !(nonnegative(amount) > 0) || !!date(paid) && paid <= asOf);
    }).length;
    function plannedHours(job) {
      if (typeof opts.planJob !== "function") return null;
      try {
        // Pass an isolated job: even a legacy callback must not change stored data.
        const planned = opts.planJob(JSON.parse(JSON.stringify(job)));
        const hours = nonnegative(planned && planned.hod);
        if (hours === null) return null;
        const approved = array(job.viceprace).filter(row => row && row.stav === "odsouhlaseno");
        return hours + approved.reduce((sum, row) => sum + (nonnegative(row.hod) || 0), 0);
      } catch (error) { issue("Odhad osobohodin zakázky se nepodařilo načíst."); return null; }
    }
    let soldHours = 0, futureBookedHours = 0, soldKnown = true, futureKnown = true;
    const committed = jobs.filter(job => WON.has(job.status));
    for (const job of committed) {
      const hours = plannedHours(job), from = date(job.terminOd), to = date(job.terminDo) || from;
      if (!from || !to || to < from || !workdays(from, to)) {
        issue("Zakázka „" + (job.nazev || "bez názvu") + "“ nemá platný pracovní termín; kapacita je neúplná.");
        soldKnown = false;
      } else {
        const overlapFrom = from > start ? from : start, overlapTo = to < end ? to : end;
        if (workdays(overlapFrom, overlapTo)) {
          if (hours === null) soldKnown = false;
          else soldHours += hours * workdays(overlapFrom, overlapTo) / workdays(from, to);
        }
      }
      if (job.status !== "hotovo") {
        if (hours === null) futureKnown = false;
        else futureBookedHours += Math.max(0, hours - (jobActualHours(job) || 0));
        if (!from || !to) issue("Nasmlouvaná práce bez termínu je zahrnuta do backlogu, nikoli spolehlivě do rozvrhu.");
        else if (to < asOf) issue("Nedokončená zakázka „" + (job.nazev || "bez názvu") + "“ má termín v minulosti; aktualizuj zbývající práci.");
      }
    }
    if (!hasBusinessEvidence) { soldKnown = false; futureKnown = false; }
    if (committed.length && typeof opts.planJob !== "function") issue("Chybí propojení s kalkulačkou osobohodin; vytížení a backlog nelze dopočítat.");
    const cash = { ...founder.cash };
    for (const key of CASH_FIELDS) cash[key] = key === 'unfundedWork' ? (typeof cash[key] === 'boolean' ? cash[key] : null) : key === "bankCash" ? number(cash[key]) : nonnegative(cash[key]);
    cash.asOf = date(cash.asOf) || "";
    if (!cash.asOf) issue("Cash snímek nemá datum ověření.");
    else if (cash.asOf > asOf) issue("Cash snímek má datum v budoucnosti.");
    else if ((new Date(asOf + "T12:00:00Z") - new Date(cash.asOf + "T12:00:00Z")) / DAY > 7) issue("Cash snímek je starší než 7 dní; před rozhodnutím ověř zůstatky a závazky.");
    if (CASH_FIELDS.some(key => cash[key] === null)) issue("Cash údaje nejsou kompletní; nevyplněné rezervy ani závazky nejsou nula.");
    const probability = nonnegative(founder.settings.quoteProbability) !== null && founder.settings.quoteProbability <= 1 ? founder.settings.quoteProbability : 0.3;
    const cashItems = [];
    let undatedPayments = 0, overduePayments = 0;
    for (const job of jobs) {
      if (job.status === "zamítnuto") continue;
      for (const [kind, label] of [["zaloha", "Záloha"], ["doplatek", "Doplatek"]]) {
        const amount = nonnegative(job[kind + "Castka"]);
        if (!(amount > 0)) continue;
        const paidDate = date(job[kind + "Zaplaceno"]);
        if (paidDate && paidDate <= asOf) continue;
        const due = date(job[kind + "Splatnost"]);
        if (!due) { undatedPayments++; continue; }
        if (due < asOf) overduePayments++;
        const committedPayment = WON.has(job.status);
        const sourceId = "job:" + (job.id || "index-" + jobs.indexOf(job)) + ":" + kind;
        cashItems.push({ id:sourceId, sourceId, jobId: job.id || null, label: label + " · " + (job.nazev || "Zakázka"), date: due, amount, direction: "in", category: "receivable", layer: committedPayment ? "committed" : "expected", probability: committedPayment ? 1 : probability, overdue: due < asOf, includesVAT: true });
      }
    }
    if (undatedPayments) issue(undatedPayments + " neuhrazených plateb nemá splatnost a chybí v cash forecastu.");
    if (overduePayments) issue(overduePayments + " neuhrazených plateb je po splatnosti; termín skutečného inkasa je nejistý.");
    if (!jobs.length) issue("Nejsou uložené zakázky. Neznámé obchodní výsledky zůstávají prázdné.");
    const currentInput = weekMap.get(currentMonday);
    const dailyAvailableHours = currentInput && nonnegative(currentInput.availableHours) !== null ? currentInput.availableHours / 5 : null;
    const result = {
      asOf, period, completedPaidJobs: paidCompleted, team: { ...founder.team },
      metrics: { qualifiedLeads, quotesSent, wonQuotes, jobsWon, completedJobs: completed.length, periodWeeks:weeklyCoverage.length, revenue, directCosts, actualHours, availableHours, soldHours: soldKnown ? soldHours : null, futureBookedHours: futureKnown ? futureBookedHours : null, dailyAvailableHours, estimatedDirectCosts, consecutiveLosses, lostTiming, lostCount, lateStartRate, reworkRate, founderDelegatableHours, founderHours, understaffed },
      cash, dataIssues, sources: { jobs: jobs.length, completed: completed.length, allCompleted: allCompleted.length, undatedCompleted: undatedCompleted.length, actualCostJobs, actualRevenueJobs, agreedRevenueJobs: completed.length - actualRevenueJobs, actualHourJobs, quotes: datedQuotes.length, weeklyInputs: weeklyCoverage.filter(item => item.row).length, weeksRequired: weeklyCoverage.length, availableHourWeeks: weeklyCoverage.filter(item => item.row && nonnegative(item.row.availableHours) !== null).length, undatedPayments, overduePayments }, cashItems
    };
    const unsupportedServices=Array.isArray(S.vyklizeni)?S.vyklizeni.length:0;
    if(unsupportedServices){
      result.completedPaidJobs=null;
      const manual=['qualifiedLeads','availableHours','dailyAvailableHours','founderHours','founderDelegatableHours','understaffed','periodWeeks'];
      for(const key of Object.keys(result.metrics))if(!manual.includes(key))result.metrics[key]=null;
      issue('Kalkulačka obsahuje také '+unsupportedServices+' záznamů vyklízení. Jejich nové účtování zatím není zahrnuté v adaptéru; souhrnné tržby, ekonomika a kapacita celé firmy proto zůstávají neznámé. Cash plán obsahuje jen zadané položky a platby demolice.');
    }
    if(opts.sourceAvailable===false){
      result.completedPaidJobs=null;
      const manual=['qualifiedLeads','availableHours','dailyAvailableHours','founderHours','founderDelegatableHours','understaffed','periodWeeks'];
      for(const key of Object.keys(result.metrics))if(!manual.includes(key))result.metrics[key]=null;
      result.cashItems=[];
      issue('Zdroj zakázek není dostupný. Obchodní výsledky ani vytížení nelze potvrdit.');
    }
    return result;
  }
  return { defaults, ensure, buildInput };
});
