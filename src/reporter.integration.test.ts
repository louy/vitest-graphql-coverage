import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import GraphQLCoverageReporter from './reporter.js';
import type { HitData } from './register.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'test-schema.graphql');

function makeMockCoverage() {
  const added: FileCoverageData[] = [];
  return {
    map: added,
    addFileCoverage: (fc: FileCoverageData) => added.push(fc),
  };
}

// After each test, restore the session dir to a clean empty state so
// subsequent tests start from a known baseline.
afterEach(() => {
  const dir = process.env.__VITEST_GRAPHQL_COVERAGE_DIR__;
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
});

describe('onInit', () => {
  it('ensures the session dir exists on disk', () => {
    const dir = process.env.__VITEST_GRAPHQL_COVERAGE_DIR__!;
    // Simulate a prior onFinished having cleaned up the dir.
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);

    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);

    expect(existsSync(dir)).toBe(true);
  });

  it('sets __VITEST_GRAPHQL_COVERAGE_DIR__ so workers can inherit it', () => {
    // The env var is established at module-load time and kept alive by onInit.
    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);

    expect(process.env.__VITEST_GRAPHQL_COVERAGE_DIR__).toBeDefined();
    expect(existsSync(process.env.__VITEST_GRAPHQL_COVERAGE_DIR__!)).toBe(true);
  });
});

describe('onFinished', () => {
  it('reads a worker json file and injects FileCoverage into the map', () => {
    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);
    const dir = process.env.__VITEST_GRAPHQL_COVERAGE_DIR__!;

    const hitData: HitData = {
      schemaFilePaths: [FIXTURE_PATH],
      fields: {
        Query: {
          user: { count: 3, args: { id: { provided: 3, nullCount: 0, nonNullCount: 3 } }, nullReturn: 1, nonNullReturn: 2 },
          users: { count: 2, args: {}, nullReturn: 0, nonNullReturn: 2 },
        },
        User: {
          id: { count: 5, args: {}, nullReturn: 0, nonNullReturn: 5 },
          name: { count: 5, args: {}, nullReturn: 0, nonNullReturn: 5 },
          email: { count: 5, args: {}, nullReturn: 2, nonNullReturn: 3 },
          posts: { count: 5, args: {}, nullReturn: 1, nonNullReturn: 4 },
        },
        Post: {
          id: { count: 4, args: {}, nullReturn: 0, nonNullReturn: 4 },
          title: { count: 4, args: {}, nullReturn: 0, nonNullReturn: 4 },
          body: { count: 4, args: {}, nullReturn: 2, nonNullReturn: 2 },
        },
      },
      inputFields: { UserFilter: { name: 1, email: 1 } },
    };
    writeFileSync(path.join(dir, `${process.pid}-0.json`), JSON.stringify(hitData));

    const coverage = makeMockCoverage();
    reporter.onFinished([], [], coverage);

    expect(coverage.map).toHaveLength(1);
    expect(coverage.map[0].path).toBe(FIXTURE_PATH);

    const s = coverage.map[0].s as Record<string, number>;
    expect(s['0']).toBe(3); // Query.user hit count
    expect(s['2']).toBe(2); // Query.users hit count
  });

  it('merges hit counts from multiple worker json files', () => {
    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);
    const dir = process.env.__VITEST_GRAPHQL_COVERAGE_DIR__!;

    const worker1: HitData = {
      schemaFilePaths: [FIXTURE_PATH],
      fields: { Query: { user: { count: 2, args: {}, nullReturn: 1, nonNullReturn: 1 } } },
      inputFields: {},
    };
    const worker2: HitData = {
      schemaFilePaths: [FIXTURE_PATH],
      fields: { Query: { user: { count: 3, args: {}, nullReturn: 0, nonNullReturn: 3 } } },
      inputFields: {},
    };
    writeFileSync(path.join(dir, '1000-0.json'), JSON.stringify(worker1));
    writeFileSync(path.join(dir, '1001-0.json'), JSON.stringify(worker2));

    const coverage = makeMockCoverage();
    reporter.onFinished([], [], coverage);

    const s = coverage.map[0].s as Record<string, number>;
    expect(s['0']).toBe(5); // 2 + 3
  });

  it('cleans up the session dir after running', () => {
    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);
    const dir = process.env.__VITEST_GRAPHQL_COVERAGE_DIR__!;
    expect(existsSync(dir)).toBe(true);

    reporter.onFinished([], [], makeMockCoverage());

    expect(existsSync(dir)).toBe(false);
  });

  it('is a no-op when coverage is null', () => {
    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);
    expect(() => reporter.onFinished([], [], null)).not.toThrow();
  });

  it('is a no-op when coverage lacks addFileCoverage', () => {
    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);
    expect(() => reporter.onFinished([], [], {})).not.toThrow();
  });

  it('skips malformed json worker files without throwing', () => {
    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);
    const dir = process.env.__VITEST_GRAPHQL_COVERAGE_DIR__!;

    writeFileSync(path.join(dir, '9999-0.json'), '{not valid json{{');

    const coverage = makeMockCoverage();
    expect(() => reporter.onFinished([], [], coverage)).not.toThrow();
    expect(coverage.map).toHaveLength(0);
  });

  it('ignores non-json files in the session dir', () => {
    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);
    const dir = process.env.__VITEST_GRAPHQL_COVERAGE_DIR__!;

    writeFileSync(path.join(dir, 'README.txt'), 'not a hit file');

    const coverage = makeMockCoverage();
    reporter.onFinished([], [], coverage);
    expect(coverage.map).toHaveLength(0);
  });

  it('adds one FileCoverage per registered schema file', () => {
    const reporter = new GraphQLCoverageReporter();
    reporter.onInit({} as never);
    const dir = process.env.__VITEST_GRAPHQL_COVERAGE_DIR__!;

    const hitData: HitData = {
      schemaFilePaths: [FIXTURE_PATH],
      fields: {},
      inputFields: {},
    };
    writeFileSync(path.join(dir, '1-0.json'), JSON.stringify(hitData));

    const coverage = makeMockCoverage();
    reporter.onFinished([], [], coverage);

    expect(coverage.map).toHaveLength(1);
  });
});
