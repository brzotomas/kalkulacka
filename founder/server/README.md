# Sdílená data Founder OS

Samostatný Cloudflare Worker s databází D1. Nesahá do kalkulačky ani jejího Supabase projektu. Údaje jsou dostupné pouze přes osobní token nebo token náhledu. Hodnoty tokenů nejsou součástí zdrojů.

## Vývoj a nasazení

Použij Node.js 24. Spusť npm ci, npm test a npm run build. Výstup je dist/server/index.js. Migrace pro D1 jsou v drizzle/ a generují se příkazem npm run db:generate. Již aplikované migrace nepřepisuj.

Existující Site určuje .openai/hosting.json. Pro jeho nasazení použij Sites workflow, ulož a pushni přesný zdrojový commit, sestav a zabal výstup včetně migrací a nasaď uloženou verzi. Samotný commit na GitHub Pages backend neaktualizuje. Backendový checkout při prvním nasazení: work/founder-cloud; jeho zdrojový commit 8446dbed0aea3f1bfc13ca3020aad2a598a8b8fc odpovídá verzi API zde.

V runtime jsou nastavené OWNER_TOKEN_HASH, VIEWER_TOKEN_HASH a VIEWER_TOKEN jako tajné hodnoty; ALLOWED_ORIGIN je https://brzotomas.github.io. Logický binding databáze je DB. Tokeny se vygenerovaly náhodně jako 32 bajtů, hash je SHA-256. Při výměně přístupů obnov runtime hodnoty a soukromé odkazy majitele, nikdy je nevkládej do veřejného commitu.

## API

- POST /api/read vrací aktuální vlastní údaje, projekci zakázek, role a obě revize. Bez tokenu vrací 401. Jen majitel navíc získá odkazový token náhledu.
- PUT /api/state a PUT /api/source zapisují samostatné dokumenty. Vyžadují token majitele, expectedRevision a jedinečné mutationId. Souběžná změna vrací 409, opakované stejné uložení je idempotentní.
- Čtení záměrně používá POST, aby se data neukládala do původního service workeru kalkulačky. Odpovědi API jsou no-store.

Testy používají skutečný SQLite pro kontrolu atomických zápisů, konfliktů revizí, oprávnění, CORS, velikosti a validace vstupů.
