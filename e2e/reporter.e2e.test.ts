import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const fixtureDir = path.join(__dirname, 'fixture-project');
const coverageDir = path.join(fixtureDir, 'coverage');
const vitestBin = path.join(rootDir, 'node_modules', '.bin', 'vitest');

type CoverageFinal = Record<string, {
  path: string;
  s: Record<string, number>;
  b: Record<string, number[]>;
  branchMap: Record<string, unknown>;
  statementMap: Record<string, unknown>;
}>;

beforeAll(() => {
  execSync('npm run build', { cwd: rootDir, stdio: 'pipe' });

  if (existsSync(coverageDir)) rmSync(coverageDir, { recursive: true, force: true });

  spawnSync(vitestBin, ['run', '--coverage'], {
    cwd: fixtureDir,
    stdio: 'pipe',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}, 60_000);

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

describe('e2e: GraphQL coverage in a real Vitest run', () => {
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
