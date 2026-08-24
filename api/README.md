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
- Protected token check: `http://localhost:3000/v1/auth/session`
- Authorized workforce directory: `http://localhost:3000/v1/admin/workforce-directory`

Authentication defaults to `AUTH_MODE=disabled`, in which protected endpoints
reject every request. Set `AUTH_MODE=cognito`, `DEPLOYMENT_ENVIRONMENT`, `COGNITO_REGION`,
`COGNITO_USER_POOL_ID`, and `COGNITO_USER_POOL_CLIENT_ID` to the non-secret
Terraform outputs for a deployed environment. The API accepts only Cognito
access tokens for that exact pool and client; ID tokens are not API bearer
tokens. Cognito groups are not treated as HIS authorization.

`local`, `development`, and `staging` require Cognito in `ap-south-1`;
`production` requires `me-central-1`. The same API artifact runs in both
regions. Local, development, and staging use the shared synthetic staging User
Pool and app client; production uses its own separately approved boundary.

The workforce-directory endpoint resolves the validated Cognito `sub` to an
active HIS identity binding and evaluates the current
`tenant.memberships.manage` assignment and organization scope in PostgreSQL.
It never trusts Cognito groups or a practice identifier supplied by the UI.
The API runtime also needs AWS permission to call `cognito-idp:ListUsers` on
the configured pool; the infrastructure repository defines the scoped policy,
but deployment must attach it to the API workload identity.

For synthetic local/staging verification, set
`SYNTHETIC_ADMIN_COGNITO_SUBJECT` to the non-secret `sub` of the controlled
staging administrator account before running `npm run db:seed`. This updates
the deterministic synthetic administrator binding. The setting is rejected
when `DEPLOYMENT_ENVIRONMENT=production`.

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

The schema models a global application user separately from tenant-scoped identity connections, organization/practice memberships, facility access, roles, permissions, approval requests, assignments, and financial approval limits. A database trigger rejects updates, deletes, and truncation of committed `audit_events`.

See the root [`README.md`](../README.md) for the full local workflow, hot reload, pgAdmin profile, service addresses, logs, and shutdown commands.

## Verification

```bash
npm run lint
npm run test
npm run test:database
npm run test:e2e
npm run build
```

`npm run test:database` requires `DATABASE_URL` and runs migrations in an isolated temporary PostgreSQL schema. In the root Docker workflow, run it with `docker compose exec api npm run test:database` after rebuilding the API image when `package.json` changes.
