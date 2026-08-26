# Contributing to Busabase

Thanks for helping improve Busabase. Bug reports, feature ideas, documentation fixes, and pull requests are welcome.

## Before you start

- Use [GitHub Discussions](https://github.com/busabase/busabase/discussions) for questions and early-stage ideas.
- Search [existing issues](https://github.com/busabase/busabase/issues) before opening a new one.
- For security vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Local development

Prerequisites: Node.js 24.18 or newer and pnpm 10.

```bash
pnpm install
cp apps/busabase/.env.example apps/busabase/.env
pnpm dev
```

Busabase opens at `http://localhost:15419`. The default setup uses embedded PGlite and local file storage.

## Validate your change

Run the checks that cover the code you changed. At minimum:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

For browser-facing behavior, also run the relevant Playwright spec:

```bash
pnpm --filter busabase test:e2e -- path/to/spec.ts
```

## Pull requests

- Keep each pull request focused on one problem.
- Explain the user-visible behavior and why the change is needed.
- Add or update tests when behavior changes.
- Include screenshots or recordings for UI changes.
- Use a clear Conventional Commit title, such as `fix: preserve node icons after rename`.
- Do not commit secrets, local data, `.env` files, or generated build output.

By participating, you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).
