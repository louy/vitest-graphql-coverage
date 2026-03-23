import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as url from 'node:url';
import { buildFileCoverage, mergeHitData } from './reporter.js';
import type { HitData } from './register.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'test-schema.graphql');

const fixtureHitData: HitData = {
  schemaFilePaths: [FIXTURE_PATH],
  fields: {
    Query: {
      user: { count: 5, args: { id: { provided: 5, nullCount: 0, nonNullCount: 5 } }, nullReturn: 1, nonNullReturn: 4 },
      users: { count: 3, args: { filter: { provided: 2, nullCount: 0, nonNullCount: 2 } }, nullReturn: 0, nonNullReturn: 3 },
    },
    User: {
      id: { count: 8, args: {}, nullReturn: 0, nonNullReturn: 8 },
      name: { count: 8, args: {}, nullReturn: 0, nonNullReturn: 8 },
      email: { count: 8, args: {}, nullReturn: 3, nonNullReturn: 5 },
      posts: { count: 8, args: {}, nullReturn: 2, nonNullReturn: 6 },
    },
    Post: {
      id: { count: 6, args: {}, nullReturn: 0, nonNullReturn: 6 },
      title: { count: 6, args: {}, nullReturn: 0, nonNullReturn: 6 },
      body: { count: 6, args: {}, nullReturn: 4, nonNullReturn: 2 },
    },
  },
  inputFields: {
    UserFilter: {
      name: 2,
      email: 2,
    },
  },
};

describe('buildFileCoverage', () => {
  it('produces correct number of statements', () => {
    const fc = buildFileCoverage(FIXTURE_PATH, fixtureHitData);
    const stmtKeys = Object.keys(fc.data.statementMap);
    // Fields: Query(2) + User(4) + Post(3) + InputFields UserFilter(2) = 11
    // Args: user.id(1) + users.filter(1) = 2
    // Total = 13
    expect(stmtKeys).toHaveLength(13);
  });

  it('maps hit counts from fixture data', () => {
    const fc = buildFileCoverage(FIXTURE_PATH, fixtureHitData);
    const s = fc.data.s as Record<string, number>;
    // Query.user is the first field of the first object type, stmtIndex 0
    expect(s['0']).toBe(5); // Query.user
    expect(s['1']).toBe(5); // Query.user's id arg
    expect(s['2']).toBe(3); // Query.users
    expect(s['3']).toBe(2); // Query.users' filter arg
  });

  it('zero counts for uncovered fields', () => {
    const emptyHitData: HitData = {
      schemaFilePaths: [FIXTURE_PATH],
      fields: {},
      inputFields: {},
    };
    const fc = buildFileCoverage(FIXTURE_PATH, emptyHitData);
    const s = fc.data.s as Record<string, number>;
    for (const v of Object.values(s)) {
      expect(v).toBe(0);
    }
  });

  it('produces branches for ! types', () => {
    const fc = buildFileCoverage(FIXTURE_PATH, fixtureHitData);
    const bKeys = Object.keys(fc.data.branchMap);
    // Count ! in schema:
    // Query.user: id: ID! (arg) = 1
    // Query.users: [User!]! (return: 2 bangs) + filter: UserFilter (no bang)
    // User.id: ID! = 1, User.name: String! = 1, User.posts: [Post!] = 1 (inner bang)
    // Post.id: ID! = 1, Post.title: String! = 1
    // UserFilter.email: String! = 1
    // Total: 1(user arg) + 2(users return) + 1(User.id) + 1(User.name) + 1(User.posts inner) + 1(Post.id) + 1(Post.title) + 1(UserFilter.email) = 9
    expect(bKeys.length).toBe(9);
  });

  it('branch counts for return nullability', () => {
    const fc = buildFileCoverage(FIXTURE_PATH, fixtureHitData);
    const b = fc.data.b as Record<string, number[]>;
    // Walk order:
    // stmt 0: Query.user field - return type is User (nullable NamedType) -> no branch
    // stmt 1: Query.user id arg - type is ID! -> branch 0: [nullCount=0, nonNullCount=5]
    // stmt 2: Query.users field - return type is [User!]! -> outer NonNull -> branch 1: [0,3], inner (inside list) NonNull -> branch 2: [0,3]
    // stmt 3: Query.users filter arg - type is UserFilter (no !) -> no branch
    expect(b['0']).toEqual([0, 5]); // user.id arg
    expect(b['1']).toEqual([0, 3]); // users return outer !
    expect(b['2']).toEqual([0, 3]); // users return inner !
  });

  it('type definition lines are not in statementMap', () => {
    const fc = buildFileCoverage(FIXTURE_PATH, fixtureHitData);
    const stmtMap = fc.data.statementMap as Record<string, { start: { line: number }; end: { line: number } }>;
    const statementLines = Object.values(stmtMap).map(r => r.start.line);
    // "type Query {" is line 1 - should NOT be a statement start
    expect(statementLines).not.toContain(1);
  });

  it('enum and scalar definitions are not in statementMap', () => {
    const fc = buildFileCoverage(FIXTURE_PATH, fixtureHitData);
    const stmtKeys = Object.keys(fc.data.statementMap);
    // Still 13
    expect(stmtKeys).toHaveLength(13);
  });
});

describe('mergeHitData', () => {
  it('sums field counts across sources', () => {
    const src1: HitData = {
      schemaFilePaths: ['/a.graphql'],
      fields: { Query: { hello: { count: 3, args: {}, nullReturn: 1, nonNullReturn: 2 } } },
      inputFields: {},
    };
    const src2: HitData = {
      schemaFilePaths: ['/a.graphql'],
      fields: { Query: { hello: { count: 2, args: {}, nullReturn: 0, nonNullReturn: 2 } } },
      inputFields: {},
    };
    const merged = mergeHitData([src1, src2]);
    expect(merged.fields['Query']['hello'].count).toBe(5);
    expect(merged.fields['Query']['hello'].nullReturn).toBe(1);
    expect(merged.fields['Query']['hello'].nonNullReturn).toBe(4);
  });

  it('merges schema file paths (union)', () => {
    const src1: HitData = { schemaFilePaths: ['/a.graphql'], fields: {}, inputFields: {} };
    const src2: HitData = { schemaFilePaths: ['/a.graphql', '/b.graphql'], fields: {}, inputFields: {} };
    const merged = mergeHitData([src1, src2]);
    expect(merged.schemaFilePaths).toHaveLength(2);
    expect(merged.schemaFilePaths).toContain('/a.graphql');
    expect(merged.schemaFilePaths).toContain('/b.graphql');
  });

  it('sums arg counts across sources', () => {
    const src1: HitData = {
      schemaFilePaths: [],
      fields: { Query: { user: { count: 1, args: { id: { provided: 1, nullCount: 0, nonNullCount: 1 } }, nullReturn: 0, nonNullReturn: 1 } } },
      inputFields: {},
    };
    const src2: HitData = {
      schemaFilePaths: [],
      fields: { Query: { user: { count: 2, args: { id: { provided: 2, nullCount: 1, nonNullCount: 1 } }, nullReturn: 1, nonNullReturn: 1 } } },
      inputFields: {},
    };
    const merged = mergeHitData([src1, src2]);
    expect(merged.fields['Query']['user'].args['id'].provided).toBe(3);
    expect(merged.fields['Query']['user'].args['id'].nullCount).toBe(1);
    expect(merged.fields['Query']['user'].args['id'].nonNullCount).toBe(2);
  });

  it('sums input field counts', () => {
    const src1: HitData = { schemaFilePaths: [], fields: {}, inputFields: { UserFilter: { name: 2 } } };
    const src2: HitData = { schemaFilePaths: [], fields: {}, inputFields: { UserFilter: { name: 3, email: 1 } } };
    const merged = mergeHitData([src1, src2]);
    expect(merged.inputFields['UserFilter']['name']).toBe(5);
    expect(merged.inputFields['UserFilter']['email']).toBe(1);
  });

  it('handles empty sources array', () => {
    const merged = mergeHitData([]);
    expect(merged.schemaFilePaths).toHaveLength(0);
    expect(merged.fields).toEqual({});
    expect(merged.inputFields).toEqual({});
  });
});
