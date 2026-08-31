# Contributing

Thanks for your interest in AI Footprint.

## Getting started

```bash
git clone <repository>
cd ai-footprint
npm install
npm run dev
```

`npm run dev` starts the API with reload and the Vite dev server, proxying `/api`.

## Before opening a pull request

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run hygiene
```

All five must pass. CI runs them on Ubuntu, macOS and Windows.

## Conventions

- TypeScript strict mode. No `any` without a written reason.
- Comment only non-obvious behaviour, architectural constraints, security reasoning, or
  cross-platform quirks. Do not restate the code.
- Commit messages describe the software change: `feat: add prompt analytics`,
  `fix: handle unavailable local ports`.
- Do not commit database files, exports, screenshots containing real prompts, or any
  other personal data.
- The repository must contain no coding-assistant attribution. `npm run hygiene` enforces
  this and fails the build.

## Adding a provider

Implement `AIProviderAdapter` in `packages/collectors/src/providers/<id>/`, declare its
`ProviderCapabilities` honestly, and register it in the provider registry. The adapter
must map its data onto the shared `AIEvent` shape; nothing downstream may special-case a
provider.

## Tests

Vitest for unit and integration tests, Playwright for end-to-end. Every bug fix gets a
regression test. Parser changes need a fixture.
