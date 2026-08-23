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

The supported Docker workflow starts the complete local stack from the repository root:

```bash
cd ..
docker compose up --build
```

The API is bound to `127.0.0.1:3000`, not exposed to the local network. Stop the stack with `docker compose down` from the root.

Compose also runs the web application and PostgreSQL 17.11. The existing `api_postgres_data` named volume survives normal container restarts and is reused by the root workflow. On startup, the API waits for PostgreSQL, runs all pending Kysely migrations, applies the idempotent synthetic seed, and starts Nest watch mode.

Database commands can also be run manually inside the API container:

```bash
docker compose -f ../compose.yaml exec api npm run db:migrate
docker compose -f ../compose.yaml exec api npm run db:seed
docker compose -f ../compose.yaml exec api npm run db:migrate:down
```

Synthetic seeding refuses to run in production and requires `ALLOW_SYNTHETIC_SEED=true`.

See the root [`README.md`](../README.md) for the full local workflow, hot reload, pgAdmin profile, service addresses, logs, and shutdown commands.

## Verification

```bash
npm run lint
npm run test
npm run test:e2e
npm run build
```
