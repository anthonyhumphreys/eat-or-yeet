Community contributors run `pnpm dev` after installing dependencies. No Convex account or manual configuration is required.

Configured cloud development deployments remain supported. `pnpm dev:web` starts only Next.js.

Verified fresh startup, persistent secrets across restart, development overrides, demo matching and complete Ctrl-C shutdown. Lint, typecheck, build, 114 unit tests, 16 browser smoke tests and production dependency audit passed.

Demo data does not establish official coverage. Live ingestion remains an optional separate step.

Cloud startup was not exercised. The browser run also logged a hydration warning despite passing its smoke assertions.