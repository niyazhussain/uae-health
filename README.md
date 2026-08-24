# UAE Health

Hospital Information System foundation with a React/Vite frontend, NestJS API, and PostgreSQL database. Local environments contain synthetic data only.

## Local development with Docker

Prerequisites:

- Rancher Desktop or another Docker-compatible runtime
- Docker Compose v2

From the repository root, start the web application, API, and PostgreSQL:

```bash
docker compose up --build
```

Use detached mode if you want the terminal back:

```bash
docker compose up --build --detach
docker compose logs --follow web api
```

Local services:

| Service | Address |
| --- | --- |
| Web application | `http://localhost:5173` |
| API documentation | `http://localhost:3000/docs` |
| API health | `http://localhost:3000/health` |
| API readiness | `http://localhost:3000/health/ready` |
| PostgreSQL | `localhost:5433` |

Edits under `web/src` trigger Vite hot-module reload. Edits under `api/src` restart the NestJS development process. The API waits for PostgreSQL, applies pending Kysely migrations, and runs the idempotent synthetic seed before it starts.

Workforce authentication uses Cognito in browser memory only for the initial
password and authenticator challenges. The UI exchanges the resulting access
token once for a PostgreSQL-backed opaque API session, clears every Cognito
token, and restores the HttpOnly cookie-backed session after a page reload.

### Rancher Desktop command path

If Rancher Desktop is running but `docker` is not found, add its command directory for the current terminal:

```bash
export PATH="$HOME/.rd/bin:$PATH"
```

Then run `docker compose up --build` again.

## Optional pgAdmin

Copy the local environment example and choose a local-only pgAdmin password:

```bash
cp .env.example .env
```

Start the application with the optional database tool:

```bash
docker compose --profile tools up --build
```

Open `http://localhost:5050` and sign in with `PGADMIN_DEFAULT_EMAIL` and `PGADMIN_DEFAULT_PASSWORD` from `.env`. The `UAE Health Local` server is registered automatically. When connecting, enter the synthetic PostgreSQL password `local-development-only`. pgAdmin and PostgreSQL bind only to `127.0.0.1`; pgAdmin must never be configured with production endpoints or credentials.

## Useful commands

```bash
# Show service health and ports
docker compose ps

# Follow logs
docker compose logs --follow web api postgres

# Run migrations or the synthetic seed manually
docker compose exec api npm run db:migrate
docker compose exec api npm run db:seed

# Stop containers while preserving PostgreSQL and pgAdmin volumes
docker compose down

# Rebuild after changing package dependencies or a Dockerfile
docker compose up --build
```

Do not add `--volumes` to `docker compose down` unless you intentionally want to delete all local database and pgAdmin data.

## Development without Docker

PostgreSQL must still be available at the configured `DATABASE_URL`.

```bash
# Terminal 1
cd api
npm install
npm run start:dev

# Terminal 2
cd web
npm install
npm run dev
```

Package-specific details are available in [`api/README.md`](api/README.md) and [`web/README.md`](web/README.md). Architecture and delivery decisions are tracked under [`openspec/`](openspec/README.md).
