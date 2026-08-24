# UAE Health web application

React 19, TypeScript, Vite, Tailwind CSS v4, and owned shadcn/ui components provide the frontend foundation for the HIS.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run build
npm run preview
```

The Vite development server provides hot-module reload. The supported Docker workflow starts the complete stack from the repository root with `docker compose up --build`; see the root [`README.md`](../README.md).

## Design-system structure

- `src/index.css` defines semantic light and dark tokens, typography, radii, and reduced-motion behavior.
- `src/components/ui` contains the shadcn/Radix component source owned by this repository.
- `src/lib/theme.ts` applies and safely persists the non-sensitive theme preference.
- `components.json` configures future shadcn additions for TypeScript, Radix, RTL, and Phosphor icons.

Feature code should use semantic utilities such as `bg-background`, `text-foreground`, `border-border`, and `text-destructive`. Do not introduce feature-specific copies of the foundation palette. Status meaning must always be communicated with text or accessible labels, not color alone.

The current page is a synthetic workforce-administration interface. It must not contain real patient, provider, or customer information.

## Staging workforce sign-in

Copy `.env.example` to `.env.local` and set the non-secret staging User Pool
and app-client identifiers. The sign-in flow uses Cognito SRP and handles the
temporary-password, authenticator setup, and TOTP challenge states. The
browser presents the resulting access token once to the API session-exchange
endpoint, then signs out the Cognito SDK object and clears all access, refresh,
and ID tokens from memory.

The API sets a host-only HttpOnly cookie backed by a hashed PostgreSQL session.
The UI restores that session after a reload with `credentials: "include"` and
never reads the cookie. Authenticated API activity extends the 15-minute idle
expiry while the fixed 8-hour absolute expiry never moves. A `401` clears the
UI session; a `403` preserves the session and displays the authorization
failure. The API, not the browser, decides which practices the user may manage.
