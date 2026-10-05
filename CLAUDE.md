# CLAUDE.md

Guidance for Claude (or any agent) working on this repository from a fresh chat. Read it fully before changing anything.

## Talking to the owner

- The owner (aechavarris) writes in **Spanish**: answer in Spanish, keep code, comments, commits and PRs in English.
- They usually work **locally on Windows** (PowerShell, Docker Desktop, Node 24 LTS, pnpm 10) in `C:\Users\aecha\Desarrollos localhost\wow-roster`. Give PowerShell commands for their machine, not bash.
- Never ask them to paste secrets (Blizzard client secret, Tailscale auth key, tokens) into the chat; they go in `.env` files.
- Workflow they expect: work on a branch, open a PR against `main`, wait for CI to be green, squash-merge. Merging to `main` deploys automatically (see Deployment).
- Verify claims before stating them as fact (game data especially): they have corrected unverified assumptions before.

## What the product is

A web app to manage **raid rosters** for World of Warcraft, aimed first at **World of Warcraft: Forever**, inspired by wowaudit, wowutils, ThatsMyBIS and softres.it. UI in Spanish and English. Public, multi-guild, Battle.net login.

Everything must be **data-driven and configurable**: game rules live in JSON profiles, never hard-coded, so new content (raid sizes, raids, buffs, versions) needs no code changes.

### Game versions (core concept)

Each **roster** and each **character** belongs to a game version (`gameVersion`), which is a full profile in `packages/config/profiles/`:

| id | Rules | Blizzard API namespace |
|---|---|---|
| `forever` | WoW: Forever | none yet (`api.available: false`) → rosters hold **planned characters only** |
| `classic-era` | Vanilla 1.15, 9 classes, raids 20/40 | `classic1x` |
| `anniversary` | TBC (Anniversary realms, phase 3 Black Temple as of Oct 2026), level 70 | `classicann` |
| `progression` | Mists of Pandaria Classic (final phase, Siege of Orgrimmar), 11 classes | `classic` |
| `retail` | Modern retail, 13 classes | retail (no prefix) |

Rules that must hold:

- **Never translate between versions.** A Classic roster has Combat rogues and Classic buffs; a retail roster has Outlaw rogues and retail buffs. Spec matching uses the version's own `blizzardIds`/`apiNames` only.
- The version is chosen when a roster is created. The **owner only** can change it, and only on custom rosters with no real characters (planned specs that do not exist in the new version are cleared). Guild-linked rosters keep their guild's version.
- Characters are unique per `(gameVersion, region, realm, nameKey)`: the same name can exist in several versions.
- Versions without an API throw `ApiUnavailableError` (HTTP 409 `game_version_without_api`) when something needs the API.
- `DEFAULT_GAME_VERSION` (older name `GAME_PROFILE`, alias `retail-dev` → `retail`) only sets the version preselected in forms. Existing data from before versions existed is `retail`.

### Verified facts about WoW: Forever (as of October 2026)

Use these; do not reintroduce Classic Era assumptions. Sources were official Blizzard posts unless noted.

- Launch **4 Nov 2026** (beta since 17 Sep). Level cap 60.
- **No realms**: 4 rulesets (Normal, PvP, RP, Hardcore later). Character names have **two parts** and the full name is unique per region. Guilds live inside a ruleset. The code treats `realm` as an opaque key (ruleset for Forever).
- Raids: **Barrow Deeps (10)** and **Hyjal Summit (20)** on 9 Dec; 10- and 20-player content each patch, one version per raid, no flex. **40-player raids are unconfirmed** (only fan sites citing a roadmap image): modelled but **disabled**.
- **No attunements** at launch raids (future unknown) → generic requirement tracking, disabled by default.
- **World buffs do not work in raids** → no world-buff tracking. Consumable checks stay (configurable list).
- Talents: 3 trees per class with a new milestone at 16 points. **Dual spec** from level 40.
- Many buffs become baseline (Kings, Divine Spirit, Battle Shout…); Fear Ward for every priest race. Buff lists are configurable per version.
- Paladins and shamans in both factions. Hit and crit merged (fan sites). Tier sets 2/3/4/5/6 pieces (datamining). No gems.
- New: account-wide Legacy points, camps, optional transmog. Addons will be restricted (interrupt trackers more limited) → export plain-text notes, do not depend on addons.
- **The Forever API namespace is not public** (forum thread unanswered). That is why development uses the other versions' APIs.

### Feature plan

Phases: (1) Docker, CI/CD, login, guilds, roster, character sheet — **done**; then custom rosters, invites, planned characters, composition, visual character sheet, game versions — **done**. Next: (2) audit sheet with configurable rules, weekly history, optional Google Sheet like wowaudit; (3) calendar with Discord bot, sign-ups, attendance; (4) raid composition/assignments with MRT note export, loot (MS > OS + roll only, Gargul/RCLootCouncil import/export); (5) Warcraft Logs, professions, guild bank, requirements. Out of scope for now: recruitment, public API, generic notifications. A small companion addon will export what the API lacks (bank, professions, attunements).

## Architecture

pnpm monorepo, TypeScript everywhere.

```
apps/web         Next.js 16 (App Router) + next-intl (es/en) + Tailwind 4. Server components fetch the API.
apps/api         Fastify: Battle.net OAuth, rosters (guilds), members/invites, characters, config.
apps/worker      BullMQ workers: scheduled guild sync, rate-limited character sync.
packages/config  Game version profiles (JSON) + zod schemas + helpers (composition, stat panel).
packages/blizzard Blizzard API client and normalizers (retail and Classic payloads).
packages/core    Sync logic, roster grouping, static cache (icons, talent trees), queue ids. Shared by api/worker.
packages/db      Prisma 7 schema, migrations, seed (PostgreSQL). Client generated to src/generated (gitignored).
deploy/          Caddyfile, Tailscale serve config, home .env template.
```

Data model essentials (`packages/db/prisma/schema.prisma`): `Guild` is any roster (`kind` = `guild` linked to an in-game guild, or `custom`), with `gameVersion`. `RosterEntry` links a roster to a real `Character` or holds a **planned** character (`plannedClassId`, `plannedSpec`, `plannedName`, `playerName`, `userId`). `GuildMembership` roles: OWNER > OFFICER > MEMBER (officers of linked guilds are also detected by in-game rank). `RosterInvite` stores hashed invite tokens. `StaticCache` keys are `<gameVersion>:<region>:...`.

Web routes: `/[locale]` home, `/[locale]/guild/[id]` roster (+ `/settings`), `/[locale]/character/[version]/[region]/[realm]/[name]`, `/[locale]/invite/[token]`. API under `/api`, e.g. `/api/characters/:version/:region/:realm/:name`, `/api/talent-trees/:version/:region/:treeId/:specId`, `/api/config` (all versions, no namespaces).

## Commands

Local dev on Windows (PowerShell, from the repo root):

```powershell
docker compose up -d postgres redis      # databases only
pnpm install
pnpm db:deploy                           # apply migrations
pnpm --filter @wow/db seed               # optional demo guild (Classic Era)
pnpm dev                                 # web :3000, api :4000, worker
```

Tests need a separate database once: `docker compose exec postgres createdb -U wow wow_roster_test`, then apply migrations to it with `DATABASE_URL` pointing at `wow_roster_test`. Before pushing, run what CI runs:

```powershell
pnpm typecheck; pnpm test; pnpm build
```

- `prisma migrate dev` is interactive. In non-interactive shells write the migration SQL by hand under `packages/db/prisma/migrations/<timestamp>_<name>/`, apply it with `prisma migrate deploy`, and check `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` prints an empty migration. Run `pnpm db:generate` after schema changes (Prisma 7 does not regenerate on migrate).
- Full stack in containers: `docker compose --profile app up --build`.
- To check UI changes, run the dev servers and drive pages with Playwright (headless Chromium): create throwaway users with a session row in the DB (cookie `wr_session` holds the raw token; the DB stores its SHA-256), screenshot light/dark/mobile, then delete the users.

## Conventions

- TypeScript strict; validate all input with zod; API errors are `HttpError(status, code)` and the web shows `errors.<code>` translations.
- Every UI string goes in `apps/web/messages/es.json` **and** `en.json` with the same keys.
- Game data and rules belong in the profiles, not in components. Profiles can `extends` another and override arrays by key (`roles`, `classes`, `raidSizes`, `raids`, `rosterStatuses`); `statPanel` and `buffs` are replaced whole. `packages/config/src/composition.test.ts` checks every buff provider references a real class/spec of its version.
- Match the surrounding style: JSDoc comments that explain *why*, no Prettier config (hand-formatted, ~130 columns).
- Next.js 16 differs from older versions (async `params`/`cookies()`, `proxy.ts` instead of middleware, Turbopack). Read `apps/web/AGENTS.md` and the docs in `node_modules/next/dist/docs/` before writing web code.
- Class colors on text use `classText(color)` + the `text-class` class so yellow/white stay readable in the light theme.
- Commits: imperative subject, body explaining why. Never commit `.env`, `apps/web/next-env.d.ts` or `dump.rdb` (all gitignored).

## Gotchas already hit (do not repeat)

- BullMQ: job ids cannot contain `:` (use `character-<id>`), and BullMQ 6 needs an explicit ioredis connection.
- Prisma Json columns: write `Prisma.DbNull` for SQL NULL; `undefined` keeps the old value.
- Retail talent tree API repeats hero nodes inside the spec tree and includes option-less nodes: the normalizer filters both. Classic APIs return 404 for talent trees and spell icons (talents render as lists) and for professions.
- Character endpoints 404 for inactive or hidden profiles: sync marks them `not_found` without failing.
- `pnpm dev` filter glob must stay quoted (`"./apps/**"`) or sh expands it on Linux/macOS.
- Blizzard OAuth redirect must exactly match `${PUBLIC_URL}/api/auth/callback` registered at develop.battle.net (localhost and the public URL are both registered). Changing `PUBLIC_URL` needs `docker compose up -d` (recreate), not `restart`.

## Deployment

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on PRs and `main`. On green `main`, `deploy.yml` builds four images (`migrate`, `api`, `worker`, `web`) to GHCR (`ghcr.io/aechavarris/wow-roster/*`, public) and deploys. Only pushes to this repository publish/deploy (fork PRs never do).

Production currently runs on the **owner's Windows PC** (`DEPLOY_TARGET=home` repository variable):

- A **self-hosted GitHub Actions runner** (`C:\actions-runner`, label `wow-roster-home`, Windows service under the owner's account) copies the compose files to `C:\wow-roster-prod` and runs `docker compose -f docker-compose.prod.yml -f docker-compose.home.yml up -d` (project `wow-roster-prod`, separate from the dev stack).
- `C:\wow-roster-prod\.env` (template `deploy/home.env.example`) holds production secrets. `POSTGRES_PASSWORD` must not change after the first start.
- **Tailscale Funnel** publishes the site at `https://wow-roster.tail3d07cb.ts.net` (no router ports, HTTPS by Tailscale). Funnel needs the `funnel` node attribute in the tailnet policy (`nodeAttrs`). Funnel proxies to `http://caddy:80`; Caddy routes `/api` to the API and the rest to the web.
- Caddy and Tailscale read their mounted config only at start; the deploy job recreates them when `deploy/Caddyfile` or `deploy/tailscale-serve.json` change.
- Disable key expiry for the `wow-roster` machine in the Tailscale admin console, or it logs out after 180 days.

A VPS deploy over SSH (`DEPLOY_HOST` secrets, Caddy with automatic HTTPS on a domain) is still supported; see README.
