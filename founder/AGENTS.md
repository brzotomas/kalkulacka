# Pokyny majitele pro Founder OS

- Neupravovat existující kalkulačku: zejména kořenový index.html, sw.js, manifest.json, ikony ani její původní data. Úpravy patří pouze do námi vytvořené složky founder/ a nových testů v tests/.
- Kalkulačku pouze číst. Nikdy nezapisovat do demolice-kalk-v1, její synchronizace, Supabase ani jejího účtu. Sdílená data Founder OS mají samostatný server a databázi.
- Majitel požaduje ověřené změny Founder OS průběžně zveřejňovat na GitHubu a online. Před publikací načíst aktuální main a zachovat všechny jeho původní soubory. Přidávat pouze vlastní soubory. Nikdy force push ani přepsání starým checkoutem.
- Aplikace: https://brzotomas.github.io/kalkulacka/founder/. Frontend zveřejňuje stávající GitHub Pages. Backend je samostatný Site určený manifestem server/.openai/hosting.json; jeho změny vyžadují samostatné nasazení. Nezakládat duplicitní Site.
- Ve veřejném repozitáři nesmějí být přístupové tokeny, firemní zálohy ani skutečná firemní data. Nastavení serveru obsahuje jen názvy proměnných. Přístupy předávat majiteli soukromě.
- Čtení API používá POST, protože původní service worker kalkulačky ukládá GET. Jeho kód kvůli tomu neměnit.
- Uložení potvrzovat až po odpovědi serveru. Zachovat kontrolu revize, oddělené revize zakázek a vlastních údajů, ochranu rozepsaných formulářů a export neúspěšného návrhu.
- Testy: node --test tests/*.test.cjs; v server/ npm test a npm run build. Kontrolovat izolaci vůči aktuálnímu origin/main, nikoli jen historické kopii kalkulačky.
