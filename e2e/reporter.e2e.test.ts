import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const fixturesDir = path.join(__dirname, 'fixtures');

// Each fixture is a self-contained project pinned to a specific Vitest major and
// installs the built package as a packed tarball. That makes the package's own
// `import 'graphql'` / `import 'vitest'` resolve from the fixture's node_modules
// (exactly as a real consumer's install would) rather than from this repo's —
// so `instanceof` checks and Vitest hooks line up with the version under test.
const VERSIONS = ['v3', 'v4'] as const;

type CoverageFinal = Record<string, {
  path: string;
  s: Record<string, number>;
  b: Record<string, number[]>;
  branchMap: Record<string, unknown>;
  statementMap: Record<string, unknown>;
}>;

function run(cmd: string, args: string[], cwd: string) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `\`${cmd} ${args.join(' ')}\` failed in ${cwd}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

// Build once, then pack the package into a tarball the fixtures can install.
let tarball: string;
beforeAll(() => {
  execSync('npm run build', { cwd: rootDir, stdio: 'pipe' });

  const packDir = path.join(os.tmpdir(), 'vitest-gql-cov-e2e-pack');
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  const packed = run('npm', ['pack', '--json', '--pack-destination', packDir], rootDir);
  const filename = (JSON.parse(packed.stdout) as Array<{ filename: string }>)[0].filename;
  tarball = path.join(packDir, filename);
}, 120_000);

describe.each(VERSIONS)('e2e: GraphQL coverage under vitest %s', (version) => {
  const fixtureDir = path.join(fixturesDir, version);
  const coverageDir = path.join(fixtureDir, 'coverage');
  const vitestBin = path.join(fixtureDir, 'node_modules', '.bin', 'vitest');

  beforeAll(() => {
    if (!existsSync(vitestBin)) {
      run('npm', ['install', '--no-audit', '--no-fund'], fixtureDir);
    }
    // Always (re)install the freshly built package so the test exercises the
    // current dist, not a stale copy from a previous run.
    run('npm', ['install', tarball, '--no-save', '--no-audit', '--no-fund'], fixtureDir);

    if (existsSync(coverageDir)) rmSync(coverageDir, { recursive: true, force: true });

    const runResult = spawnSync(vitestBin, ['run', '--coverage'], {
      cwd: fixtureDir,
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    if (runResult.status !== 0) {
      throw new Error(
        `vitest run failed for ${version}:\n${runResult.stdout}\n${runResult.stderr}`,
      );
    }
  }, 180_000);

  function readCoverage(): CoverageFinal {
    const p = path.join(coverageDir, 'coverage-final.json');
    expect(existsSync(p), 'coverage-final.json was not produced').toBe(true);
    return JSON.parse(readFileSync(p, 'utf8')) as CoverageFinal;
  }

  function getGraphQLEntry(cov: CoverageFinal) {
    const key = Object.keys(cov).find((k) => k.endsWith('schema.graphql'));
    expect(key, '.graphql file missing from coverage report').toBeDefined();
    return cov[key!];
  }

  it('the .graphql schema file appears in coverage-final.json', () => {
    const cov = readCoverage();
    const key = Object.keys(cov).find((k) => k.endsWith('schema.graphql'));
    expect(key).toBeDefined();
  });

  it('executed fields (user, users, User.*) have non-zero statement counts', () => {
    const fc = getGraphQLEntry(readCoverage());
    const nonZero = Object.values(fc.s).filter((v) => v > 0);
    expect(nonZero.length).toBeGreaterThan(0);
  });

  it('unexecuted fields (ping, UserFilter.*) have zero statement counts', () => {
    const fc = getGraphQLEntry(readCoverage());
    const zero = Object.values(fc.s).filter((v) => v === 0);
    // ping + UserFilter.name + UserFilter.active = at least 3
    expect(zero.length).toBeGreaterThanOrEqual(3);
  });

  it('produces branch entries for every ! in the schema', () => {
    const fc = getGraphQLEntry(readCoverage());
    // user.id!, [User!]! (×2), User.id!, User.name!, ping!, UserFilter.active! = 7
    expect(Object.keys(fc.branchMap).length).toBeGreaterThanOrEqual(7);
  });

  it('executed branches have non-zero arm counts', () => {
    const fc = getGraphQLEntry(readCoverage());
    const hit = Object.values(fc.b).filter((arms) => arms.some((v) => v > 0));
    expect(hit.length).toBeGreaterThan(0);
  });
});
