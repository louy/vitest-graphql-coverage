# vitest-graphql-coverage

Istanbul-compatible coverage maps for `.graphql` schema files in Vitest.

Tracks which fields, arguments, and input fields were actually exercised by your tests and surfaces the results as standard statement and branch coverage in any Istanbul reporter (HTML, lcov, text, JSON, Codecov, etc.).

[![CI](https://github.com/louy/vitest-graphql-coverage/actions/workflows/ci.yml/badge.svg)](https://github.com/louy/vitest-graphql-coverage/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/vitest-graphql-coverage)](https://www.npmjs.com/package/vitest-graphql-coverage)

## How it works

- **Statements** — each field and argument definition in your schema is a statement. The count is how many times that field/argument was resolved during your tests.
- **Branches** — each `!` (non-null marker) in your schema is a branch with two arms: _null returned_ and _non-null returned_. This tells you whether your tests exercise both nullable and non-nullable paths.

## Installation

```bash
npm install --save-dev vitest-graphql-coverage
```

Peer dependencies: `vitest ^3.0.0`, `graphql ^16.0.0`.

## Setup

### 1. Register your schema

Call `registerSchemaForCoverage` once when your server/schema is initialised — typically in the same file that builds or exports your schema.

```ts
import { buildSchema } from 'graphql';
import { readFileSync } from 'node:fs';
import { registerSchemaForCoverage } from 'vitest-graphql-coverage/register';

const schemaPath = new URL('./schema.graphql', import.meta.url).pathname;
const schema = buildSchema(readFileSync(schemaPath, 'utf8'));

registerSchemaForCoverage(schema, schemaPath);

export { schema };
```

> `registerSchemaForCoverage` is a no-op outside of Vitest (i.e. in production), so it is safe to call unconditionally.

If you load your schema from SDL files but build it with a different mechanism (e.g. code-first), you can register the file path alone:

```ts
import { registerSchemaFileForCoverage } from 'vitest-graphql-coverage/register';

registerSchemaFileForCoverage(new URL('./schema.graphql', import.meta.url).pathname);
```

### 2. Add the reporter to your Vitest config

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import GraphQLCoverageReporter from 'vitest-graphql-coverage/reporter';

export default defineConfig({
  test: {
    reporters: [new GraphQLCoverageReporter()],
    coverage: {
      provider: 'v8', // or 'istanbul'
      reporter: ['html', 'lcov', 'text'],
    },
  },
});
```

Run your tests with coverage enabled:

```bash
npx vitest run --coverage
```

Your `.graphql` files will now appear alongside your `.ts` files in the coverage report.

## Coverage semantics

| Schema construct | Statement | Branch |
|---|---|---|
| `field: Type` | resolved count | — |
| `field: Type!` | resolved count | null vs non-null return |
| `field(arg: Type): …` | times arg was provided | — |
| `field(arg: Type!): …` | times arg was provided | null vs non-null value |
| `input Foo { field: Type }` | times field was present in input | — |
| `input Foo { field: Type! }` | times field was present in input | (always non-null arm) |

## API

### `registerSchemaForCoverage(schema, schemaFilePath)`

Instruments all resolvers on the given `GraphQLSchema` to record hit counts, and registers `schemaFilePath` so the reporter knows which `.graphql` file to map results back to. Call this once per schema at startup.

### `registerSchemaFileForCoverage(schemaFilePath)`

Registers a schema file path without instrumenting resolvers. Use this when you manage resolver instrumentation separately or use a code-first schema builder that doesn't load SDL files.

### `GraphQLCoverageReporter`

A Vitest `Reporter` class. Add an instance to the `reporters` array in your Vitest config. It integrates with `@vitest/coverage-v8` and `@vitest/coverage-istanbul` by injecting `FileCoverage` entries into the Istanbul `CoverageMap` produced by the coverage provider.

## Compatibility

| | Supported |
|---|---|
| Vitest | ^3.0.0 |
| `pool: 'threads'` (default) | yes |
| `pool: 'forks'` | yes |
| `@vitest/coverage-v8` | yes |
| `@vitest/coverage-istanbul` | yes |
| GraphQL | ^16.0.0 |
| Node.js | 22, 24 |

## License

MIT
