# Founder OS — Demolice Morava

Samostatný rozhodovací modul: stav firmy, hlavní omezení, cash, posouzení rozhodnutí a týdenní review. Aplikace běží na https://brzotomas.github.io/kalkulacka/founder/. Původní kalkulačka se kvůli ní neupravuje.

## První použití

1. Otevři osobní odkaz pro úpravy ve stejném prohlížeči jako kalkulačku. Odkaz slouží jako klíč; není uložený ve veřejném repozitáři. Samotná adresa bez klíče nezpřístupní firemní data.
2. Zvol **Připojit tuto kalkulačku**. Předtím v kalkulačce ulož zakázky. Při každém novém otevření Founder OS připojení potvrď znovu. Přenáší se jen potřebná pole z místně uložených zakázek. Alternativou je **Načíst zálohu kalkulačky**.
3. V **Data a cíle** doplň týdenní poptávky, kapacitu, čas majitele a fakta zakázek. V **Cash a rezervy** potvrď zůstatek a rezervy. Prázdná pole nejsou nuly.
4. Tlačítkem **Sdílet náhled** zkopíruj odkaz pro parťáka. Uvidí společná uložená data, ale nemůže je přepsat. Osobní odkaz pro úpravy si nech pro sebe.

## Sdílení a zálohy

Vlastní údaje Founder OS se ukládají na samostatný server. Změna je potvrzená až po odpovědi serveru; ostatní otevřené stránky kontrolují novější údaje každých 5 sekund. Kontrola nepřepisuje rozepsané formuláře. Souběžný zápis ze starší verze je odmítnutý; neúspěšný návrh lze exportovat před načtením aktuálních dat. Návrh zůstává v paměti stránky, proto ji při neúspěšném ukládání nezavírej bez zálohy.

Připojení kalkulačky je pouze pro čtení klíče localStorage demolice-kalk-v1. Automatický přenos funguje, dokud je Founder OS otevřený a aktivní v tomto prohlížeči. Po zavření zůstane ostatním poslední sdílený přehled s časem přenosu. Import JSON uloží společný přehled a odpojí automatický přenos, aby jej místní kopie nepřepsala. Na stávající synchronizaci ani Supabase kalkulačky modul nesahá.

**Záloha Founder OS** obsahuje vlastní údaje, rozhodnutí a historii, nikoli původní evidenci kalkulačky. Uchovávej i samostatný export kalkulačky. Obnovení Founder zálohy po potvrzení nahradí společné vlastní údaje; původní kalkulačku nemění.

Novější samostatná evidence vyklízení má odlišný datový model. Její přítomnost se označí jako nepokryté údaje a souhrny celé firmy zůstanou neznámé. Tento modul zatím vyhodnocuje původní demoliční zakázky; cash výhled zahrnuje pouze známé platby a ruční vstupy.

**Jak číst čísla**

Chybějící nebo neplatné číselné vstupy zůstávají `null`; rozhraní je zobrazuje jako „Neznámé“ nebo pomlčku. Prázdné pole není potvrzená nula. Upozornění vysvětlují chybějící termíny, neúplná období a původ údajů.

Marže používá skutečné přímé náklady doplněné ve Founder OS. Uložené plánované náklady slouží samostatně pro porovnání se skutečností. Bez skutečných nákladů se plán nevydává za realizovanou marži. Výnos může vycházet z uložené sjednané ceny bez DPH; aplikace tento odhad označuje, dokud nedoplníš skutečné tržby. Osobohodiny a standardní délka pracovního dne určují zisk na člověkoden.

Volná hotovost odečítá od účtu daně, závazné mzdy, dodavatelské závazky, nekryté neodpracované zálohy klientů a provozní rezervu. Tyto rezervy zadávej bez překryvů. Survival runway pracuje s nezbytným týdenním výdajem včetně pravidelných mezd; nezapočítává očekávané nové příjmy.

Výhled na 13 týdnů odděluje potvrzené toky od očekávaných položek vážených pravděpodobností. Ze zakázek čte splatnosti neuhrazených záloh a doplatků. Chybějící plánované výdaje, včetně mezd a dodavatelů, doplň ručně. Týdenní výdaj pro runway se do forecastu automaticky nepřidává, aby nezdvojoval zadané platby. Zůstatky ve výhledu představují účet před rezervami a vyžadují cash snímek k datu začátku výhledu. Platby po splatnosti se automaticky nepovažují za inkasované.

Pravidla diagnózy jsou deterministická, upravitelná heuristika. Jistota závisí na úplnosti dat a velikosti vzorku. Rozhodnutí i experiment mají měřitelný očekávaný výsledek; experiment lze potvrdit až po dosažení prahu a ověření dalších podmínek. Současně může běžet jeden experiment.

## Architektura a provoz

- index.html, ui.css, ui.js: samostatné rozhraní.
- cloud.js a cloud-config.js: společná data a veřejná adresa služby, bez přístupových klíčů.
- bridge.js: validace a projekce pouze potřebných polí kalkulačky; původní úložiště nemění.
- adapter.js a engine.js: převod dat a deterministické výpočty; AI není připojena.
- server/: úplný zdroj serveru, databázové migrace, build a testy. Runtime údaje jsou mimo repozitář.
- demo.js: smyšlená data jen pro lokální ?demo=1.

GitHub Pages zveřejní frontend po commitu do main. Změny backendu je nutné také nasadit na existující Site ze server/.openai/hosting.json. Zachovej oddělení od původní kalkulačky podle AGENTS.md.

Testy frontendu: node --test tests/*.test.cjs z kořene repozitáře. Pro kontrolu vůči jiné verzi původní kalkulačky nastav FOUNDER_REFERENCE_HTML na její soubor. Server: Node.js 24, npm ci, npm test a npm run build ve složce server/.
