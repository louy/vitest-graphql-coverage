import type { Reporter, Vitest, File } from 'vitest';
import type { CoverageMap } from 'istanbul-lib-coverage';
import { createFileCoverage } from 'istanbul-lib-coverage';
import { parse, TypeNode, ASTNode, InputObjectTypeDefinitionNode, ObjectTypeDefinitionNode, InterfaceTypeDefinitionNode } from 'graphql';
import { readFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { HitData } from './register.js';

interface Range {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface BranchMapping {
  loc: Range;
  type: string;
  locations: Range[];
  line: number;
}

let tempDir: string | undefined;

function locationFromNode(node: ASTNode): Range {
  const loc = (node as { loc?: { startToken: { line: number; column: number }; endToken: { line: number; column: number } } }).loc;
  if (!loc) return { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };
  return {
    start: { line: loc.startToken.line, column: loc.startToken.column - 1 },
    end: { line: loc.endToken.line, column: loc.endToken.column - 1 },
  };
}

function getBangRange(node: ASTNode): Range {
  const loc = (node as { loc?: { end: number; startToken: { line: number; column: number }; endToken: { line: number; column: number } } }).loc;
  if (!loc) return { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };
  // The ! is the last character of a NonNullType node
  return {
    start: { line: loc.endToken.line, column: loc.endToken.column - 2 },
    end: { line: loc.endToken.line, column: loc.endToken.column - 1 },
  };
}

interface BranchContext {
  typeName: string;
  fieldName: string;
  kind: 'return' | 'arg' | 'input';
  argName?: string;
  hitData: HitData;
  branchMap: Record<string, BranchMapping>;
  b: Record<string, number[]>;
  branchIndex: { value: number };
}

function walkTypeForBranches(typeNode: TypeNode, ctx: BranchContext): void {
  if (typeNode.kind === 'NonNullType') {
    const idx = ctx.branchIndex.value++;
    const bangRange = getBangRange(typeNode);

    ctx.branchMap[idx] = {
      loc: bangRange,
      type: 'if-else',
      locations: [bangRange, bangRange],
      line: bangRange.start.line,
    };

    const fieldData = ctx.hitData.fields[ctx.typeName]?.[ctx.fieldName];

    let nullCount = 0;
    let nonNullCount = 0;

    if (ctx.kind === 'return') {
      nullCount = fieldData?.nullReturn ?? 0;
      nonNullCount = fieldData?.nonNullReturn ?? 0;
    } else if (ctx.kind === 'arg' && ctx.argName) {
      nullCount = fieldData?.args[ctx.argName]?.nullCount ?? 0;
      nonNullCount = fieldData?.args[ctx.argName]?.nonNullCount ?? 0;
    } else if (ctx.kind === 'input') {
      const total = ctx.hitData.inputFields[ctx.typeName]?.[ctx.fieldName] ?? 0;
      nonNullCount = total;
      nullCount = 0; // non-null input fields: null arm unused
    }

    ctx.b[idx] = [nullCount, nonNullCount];

    walkTypeForBranches(typeNode.type, ctx);
  } else if (typeNode.kind === 'ListType') {
    walkTypeForBranches(typeNode.type, ctx);
  }
  // NamedType: leaf, stop
}

export function mergeHitData(sources: HitData[]): HitData {
  const merged: HitData = {
    schemaFilePaths: [],
    fields: {},
    inputFields: {},
  };

  const pathSet = new Set<string>();

  for (const src of sources) {
    for (const p of src.schemaFilePaths) pathSet.add(p);

    for (const [typeName, typeFields] of Object.entries(src.fields)) {
      if (!merged.fields[typeName]) merged.fields[typeName] = {};
      for (const [fieldName, fieldData] of Object.entries(typeFields)) {
        if (!merged.fields[typeName][fieldName]) {
          merged.fields[typeName][fieldName] = { count: 0, args: {}, nullReturn: 0, nonNullReturn: 0 };
        }
        const m = merged.fields[typeName][fieldName];
        m.count += fieldData.count;
        m.nullReturn += fieldData.nullReturn;
        m.nonNullReturn += fieldData.nonNullReturn;
        for (const [argName, argData] of Object.entries(fieldData.args)) {
          if (!m.args[argName]) m.args[argName] = { provided: 0, nullCount: 0, nonNullCount: 0 };
          m.args[argName].provided += argData.provided;
          m.args[argName].nullCount += argData.nullCount;
          m.args[argName].nonNullCount += argData.nonNullCount;
        }
      }
    }

    for (const [inputTypeName, inputFields] of Object.entries(src.inputFields)) {
      if (!merged.inputFields[inputTypeName]) merged.inputFields[inputTypeName] = {};
      for (const [fieldName, count] of Object.entries(inputFields)) {
        merged.inputFields[inputTypeName][fieldName] = (merged.inputFields[inputTypeName][fieldName] ?? 0) + count;
      }
    }
  }

  merged.schemaFilePaths = Array.from(pathSet);
  return merged;
}

export function buildFileCoverage(schemaFilePath: string, hitData: HitData) {
  const source = readFileSync(schemaFilePath, 'utf8');
  const document = parse(source);

  const statementMap: Record<string, Range> = {};
  const s: Record<string, number> = {};
  const branchMap: Record<string, BranchMapping> = {};
  const b: Record<string, number[]> = {};

  let stmtIndex = 0;
  const branchIndex = { value: 0 };

  for (const def of document.definitions) {
    if (def.kind === 'ObjectTypeDefinition' || def.kind === 'InterfaceTypeDefinition') {
      const typeDef = def as ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode;
      for (const field of typeDef.fields ?? []) {
        statementMap[stmtIndex] = locationFromNode(field);
        s[stmtIndex] = hitData.fields[typeDef.name.value]?.[field.name.value]?.count ?? 0;
        stmtIndex++;

        walkTypeForBranches(field.type, {
          typeName: typeDef.name.value,
          fieldName: field.name.value,
          kind: 'return',
          hitData,
          branchMap,
          b,
          branchIndex,
        });

        for (const arg of field.arguments ?? []) {
          statementMap[stmtIndex] = locationFromNode(arg);
          s[stmtIndex] = hitData.fields[typeDef.name.value]?.[field.name.value]?.args[arg.name.value]?.provided ?? 0;
          stmtIndex++;

          walkTypeForBranches(arg.type, {
            typeName: typeDef.name.value,
            fieldName: field.name.value,
            kind: 'arg',
            argName: arg.name.value,
            hitData,
            branchMap,
            b,
            branchIndex,
          });
        }
      }
    }

    if (def.kind === 'InputObjectTypeDefinition') {
      const inputDef = def as InputObjectTypeDefinitionNode;
      for (const field of inputDef.fields ?? []) {
        statementMap[stmtIndex] = locationFromNode(field);
        s[stmtIndex] = hitData.inputFields[inputDef.name.value]?.[field.name.value] ?? 0;
        stmtIndex++;

        walkTypeForBranches(field.type, {
          typeName: inputDef.name.value,
          fieldName: field.name.value,
          kind: 'input',
          hitData,
          branchMap,
          b,
          branchIndex,
        });
      }
    }
  }

  return createFileCoverage({
    path: schemaFilePath,
    statementMap,
    s,
    branchMap,
    b,
    fnMap: {},
    f: {},
  });
}

export default class GraphQLCoverageReporter implements Reporter {
  onInit(_ctx: Vitest): void {
    tempDir = path.join(os.tmpdir(), `vitest-gql-cov-${randomUUID().slice(0, 8)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.__VITEST_GRAPHQL_COVERAGE_DIR__ = tempDir;
  }

  onFinished(_files?: File[], _errors?: unknown[], coverage?: unknown): void {
    if (!coverage || typeof (coverage as CoverageMap).addFileCoverage !== 'function') return;

    const dir = tempDir;
    if (!dir) return;

    let jsonFiles: string[];
    try {
      jsonFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }

    const sources: HitData[] = [];
    for (const file of jsonFiles) {
      try {
        const raw = readFileSync(path.join(dir, file), 'utf8');
        sources.push(JSON.parse(raw) as HitData);
      } catch {
        // skip unreadable files
      }
    }

    const hitData = mergeHitData(sources);

    for (const schemaFilePath of hitData.schemaFilePaths) {
      try {
        const fileCoverage = buildFileCoverage(schemaFilePath, hitData);
        (coverage as CoverageMap).addFileCoverage(fileCoverage);
      } catch (e) {
        console.warn(`[vitest-graphql-coverage] Failed to build coverage for ${schemaFilePath}:`, e);
      }
    }

    // Cleanup temp dir
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
    tempDir = undefined;
    delete process.env.__VITEST_GRAPHQL_COVERAGE_DIR__;
  }
}
