# UAE Health API

NestJS API using the Express adapter, TypeScript, OpenAPI, global request validation, and rate limiting.

## Local development

Copy `.env.example` to `.env` only when you need to override a local setting. Never place customer credentials or health data in this environment.

```bash
npm install
npm run start:dev
```

- Health check: `http://localhost:3000/health`
- Readiness check: `http://localhost:3000/health/ready`
- OpenAPI UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs/openapi.json`

## Docker

After a Docker-compatible desktop runtime such as Rancher Desktop is installed and running, start the local API with:

```bash
npm run docker:up
```

The API is bound to `127.0.0.1:3000`, not exposed to the local network. Stop it with `npm run docker:down`.

Compose also runs PostgreSQL 17.11 on `127.0.0.1:5433`. Its named volume survives normal container restarts. On startup, the API waits for PostgreSQL, runs all pending Kysely migrations, applies the idempotent synthetic seed, and starts Nest watch mode.

Database commands can also be run manually inside the API container:

```bash
docker compose exec api npm run db:migrate
docker compose exec api npm run db:seed
docker compose exec api npm run db:migrate:down
```

Synthetic seeding refuses to run in production and requires `ALLOW_SYNTHETIC_SEED=true`.

Rancher Desktop users whose shell reports `docker: command not found` should add `$HOME/.rd/bin` to their shell `PATH`, then open a new terminal.

## Verification

```bash
npm run lint
npm run test
npm run test:e2e
npm run build
```
