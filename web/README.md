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

The current page is a synthetic design-system preview. It must not contain real patient, provider, or customer information.
