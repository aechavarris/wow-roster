# WoW Roster

Roster manager for **World of Warcraft: Forever** guilds, inspired by wowaudit and wowutils.

It syncs guilds and characters from the Blizzard API and groups mains and alts per player (verified through Battle.net login). Each character page shows gear, talents for both specs, stats, professions and reputations. The UI is in Spanish and English.

> **Status: phase 1 of 5.** Done: base, Docker, CI/CD, login, guilds, roster and character pages.
> Next: the audit sheet (with an optional Google Sheet), raid calendar and Discord, raid composition and loot, then Warcraft Logs, professions and the guild bank.

## Game versions

Every roster belongs to a **game version**, and so does every character. A version is a full set of rules plus the Blizzard API it reads from, defined in [packages/config/profiles](packages/config/profiles), not in code:

- classes, specs and roles
- raid sizes and raids
- raid buffs, debuffs and utilities (composition)
- roster statuses and the stats panel layout
- Blizzard API namespaces and which character endpoints exist
- sync limits

| Version | Rules | API |
|---|---|---|
| `forever` | World of Warcraft: Forever. Raids of 10 and 20 players are enabled; 40 is defined but paused. | None yet: rosters only hold planned characters until Blizzard publishes the namespace. |
| `classic-era` | Vanilla 1.15: 9 classes, talent trees, vanilla buffs, raids of 20 and 40. | `classic1x` |
| `anniversary` | The Burning Crusade (Anniversary realms, phase 3): level 70, TBC buffs and raids. | `classicann` |
| `progression` | Mists of Pandaria Classic: 11 classes, MoP buff categories and raids. | `classic` |
| `retail` | Modern retail: 13 classes, current raid buffs and stats. | retail |

Rules are never translated between versions: a Classic roster has Combat rogues, a retail one Outlaw rogues. The version is picked when a roster is created; the owner can change it in the roster settings while the roster only holds planned characters (a roster linked to an in-game guild keeps its guild's version). The same character name can exist in several versions.

`DEFAULT_GAME_VERSION` sets the version preselected in forms (the older `GAME_PROFILE` still works). `GAME_PROFILE_PATH` can add a custom version from a JSON file that `extends` a built-in one and overrides entries by key.

Forever has no realms (it uses rulesets), so the code treats `realm` as an opaque key: a realm slug in the other versions and the ruleset in Forever.

## Architecture

```
apps/web       Next.js 16 + next-intl (ES/EN) + Tailwind 4
apps/api       Fastify: Battle.net OAuth, guilds, roster, characters
apps/worker    BullMQ: scheduled guild sync, rate-limited character sync
packages/config    Game versions (zod-validated JSON profiles)
packages/blizzard  Blizzard API client + normalizers (retail and Classic payloads)
packages/core      Sync logic, queues, roster grouping (shared by api and worker)
packages/db        Prisma 7 schema and migrations (PostgreSQL)
```

The worker refreshes each guild on its own interval (default 60 min, minimum 15). A character's details are only re-fetched when it has logged in since the last sync, which saves API quota. Blizzard allows 36,000 requests per hour.

## Local development

Requirements: Node 22+, pnpm 10, Docker.

```bash
cp .env.example .env          # fill BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET
docker compose up -d postgres redis
pnpm install
pnpm db:deploy                 # apply migrations
pnpm --filter @wow/db seed     # optional: demo guild without Blizzard credentials
pnpm dev                       # web :3000, api :4000, worker
```

In the Blizzard client at <https://develop.battle.net/access/clients>, register the redirect URL `http://localhost:3000/api/auth/callback`.

Tests (they need the test DB: `docker compose exec postgres createdb -U wow wow_roster_test`, then `DATABASE_URL=…/wow_roster_test pnpm db:deploy`):

```bash
pnpm typecheck && pnpm test
```

### Everything in containers

```bash
docker compose --profile app up --build
```

## Production

Each push to `main` runs CI. When CI passes, [deploy.yml](.github/workflows/deploy.yml) builds the four images and publishes them to GHCR (`ghcr.io/aechavarris/wow-roster/{migrate,api,worker,web}`). If a server is configured, it then deploys them to it.

One-time server setup (any VPS with Docker):

1. Create `/opt/wow-roster/.env` from `.env.example`. Set `DOMAIN`, `PUBLIC_URL=https://<domain>`, a strong `POSTGRES_PASSWORD` and the Blizzard credentials.
2. Point the domain's DNS at the server and open ports 80 and 443.
3. Add these repository secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, and optionally `DEPLOY_PORT` and `DEPLOY_PATH`.
4. In the Blizzard client, add `https://<domain>/api/auth/callback` as a redirect URL.

Caddy issues the HTTPS certificate automatically and routes `/api` to the API and everything else to the web app.

### Self-hosting on a home PC

For a low-traffic instance, a PC that stays on can be the server; deploys still come from GitHub. [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) publishes the site at `https://<name>.<tailnet>.ts.net` with HTTPS. It needs no open router ports, no domain and no fixed IP. A self-hosted GitHub Actions runner on the PC pulls the new images after every green push to `main`. [docker-compose.home.yml](docker-compose.home.yml) layers this on top of the production stack under its own project name (`wow-roster-prod`), so it does not collide with the dev stack.

One-time setup (Windows with Docker Desktop):

1. **Tailscale**: create a free account, enable *MagicDNS* and *HTTPS certificates* under DNS in the admin console, check that the access policy grants the `funnel` attribute (new tailnets do), and create a **reusable, non-ephemeral** auth key.
2. **Production folder**: create `C:\wow-roster-prod\.env` from [deploy/home.env.example](deploy/home.env.example) with the auth key, a strong `POSTGRES_PASSWORD` and the Blizzard credentials. `PUBLIC_URL` is `https://<TS_HOSTNAME>.<tailnet>.ts.net`; the tailnet name is in the admin console.
3. **Blizzard client**: add `<PUBLIC_URL>/api/auth/callback` as a redirect URL.
4. **Runner**: in the repository, open *Settings → Actions → Runners → New self-hosted runner → Windows* and follow the steps, with two changes. Add the label `wow-roster-home`. Install it as a service that runs under your own Windows account (`config.cmd … --labels wow-roster-home --runasservice --windowslogonaccount <user>`), so it can reach Docker Desktop.
5. **Repository variable**: under *Settings → Secrets and variables → Actions → Variables*, add `DEPLOY_TARGET=home`, plus `HOME_DEPLOY_PATH` if you chose another folder.
6. **Public images**: the PC pulls the images without credentials. Make the four packages (`wow-roster/migrate`, `api`, `worker`, `web`) public under your GitHub profile's *Packages* tab: *Package settings → Change visibility*.
7. **First deploy**: run the *Deploy* workflow by hand (*Actions → Deploy → Run workflow*).

Keep Docker Desktop set to start on sign-in and the PC from sleeping. Only CI runs triggered by pushes to this repository reach the runner; pull requests from forks never deploy.
