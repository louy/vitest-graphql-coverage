import { GraphQLSchema, GraphQLObjectType, GraphQLInterfaceType, GraphQLInputObjectType, isInputObjectType, getNamedType, defaultFieldResolver } from 'graphql';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';

export interface ArgHitData {
  provided: number;
  nullCount: number;
  nonNullCount: number;
}

export interface FieldHitData {
  count: number;
  args: Record<string, ArgHitData>;
  nullReturn: number;
  nonNullReturn: number;
}

export interface HitData {
  schemaFilePaths: string[];
  fields: Record<string, Record<string, FieldHitData>>;
  inputFields: Record<string, Record<string, number>>;
}

const registeredFilePaths = new Set<string>();
const fieldHits: Record<string, Record<string, FieldHitData>> = {};
const inputFieldHits: Record<string, Record<string, number>> = {};
let exitHandlerRegistered = false;

function recordFieldHit(typeName: string, fieldName: string): void {
  if (!fieldHits[typeName]) fieldHits[typeName] = {};
  if (!fieldHits[typeName][fieldName]) {
    fieldHits[typeName][fieldName] = { count: 0, args: {}, nullReturn: 0, nonNullReturn: 0 };
  }
  fieldHits[typeName][fieldName].count++;
}

function recordArgHit(typeName: string, fieldName: string, argName: string, value: unknown): void {
  if (!fieldHits[typeName]) fieldHits[typeName] = {};
  if (!fieldHits[typeName][fieldName]) {
    fieldHits[typeName][fieldName] = { count: 0, args: {}, nullReturn: 0, nonNullReturn: 0 };
  }
  const fieldData = fieldHits[typeName][fieldName];
  if (!fieldData.args[argName]) {
    fieldData.args[argName] = { provided: 0, nullCount: 0, nonNullCount: 0 };
  }
  const argData = fieldData.args[argName];
  argData.provided++;
  if (value === null || value === undefined) {
    argData.nullCount++;
  } else {
    argData.nonNullCount++;
  }
}

function recordReturn(typeName: string, fieldName: string, value: unknown): void {
  if (!fieldHits[typeName]) fieldHits[typeName] = {};
  if (!fieldHits[typeName][fieldName]) {
    fieldHits[typeName][fieldName] = { count: 0, args: {}, nullReturn: 0, nonNullReturn: 0 };
  }
  const fieldData = fieldHits[typeName][fieldName];
  if (value === null || value === undefined) {
    fieldData.nullReturn++;
  } else {
    fieldData.nonNullReturn++;
  }
}

function recordInputFieldHits(inputTypeName: string, value: Record<string, unknown>): void {
  if (!inputFieldHits[inputTypeName]) inputFieldHits[inputTypeName] = {};
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined) {
      inputFieldHits[inputTypeName][key] = (inputFieldHits[inputTypeName][key] ?? 0) + 1;
    }
  }
}

function recordInputFieldHitsRecursive(schema: GraphQLSchema, inputTypeName: string, value: unknown): void {
  if (value == null || typeof value !== 'object') return;

  const typeMap = schema.getTypeMap();
  const inputType = typeMap[inputTypeName];
  if (!inputType || !(inputType instanceof GraphQLInputObjectType)) return;

  const obj = value as Record<string, unknown>;
  recordInputFieldHits(inputTypeName, obj);

  const fields = inputType.getFields();
  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    const fieldValue = obj[fieldName];
    if (fieldValue == null) continue;
    const namedType = getNamedType(fieldDef.type);
    if (isInputObjectType(namedType)) {
      if (Array.isArray(fieldValue)) {
        for (const item of fieldValue) {
          recordInputFieldHitsRecursive(schema, namedType.name, item);
        }
      } else {
        recordInputFieldHitsRecursive(schema, namedType.name, fieldValue);
      }
    }
  }
}

function registerExitHandler(): void {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;
  process.on('exit', () => {
    try {
      const dir = process.env.__VITEST_GRAPHQL_COVERAGE_DIR__;
      if (!dir) return;
      const hitData: HitData = {
        schemaFilePaths: Array.from(registeredFilePaths),
        fields: fieldHits,
        inputFields: inputFieldHits,
      };
      const filename = path.join(dir, `${process.pid}-${Date.now()}.json`);
      writeFileSync(filename, JSON.stringify(hitData));
    } catch {
      // exit handlers must not throw
    }
  });
}

export function registerSchemaForCoverage(schema: GraphQLSchema, schemaFilePath: string): void {
  if (!process.env.VITEST) return;

  registeredFilePaths.add(schemaFilePath);
  registerExitHandler();

  const typeMap = schema.getTypeMap();
  for (const [typeName, type] of Object.entries(typeMap)) {
    if (typeName.startsWith('__')) continue;
    if (['String', 'Boolean', 'Int', 'Float', 'ID'].includes(typeName)) continue;

    if (type instanceof GraphQLObjectType || type instanceof GraphQLInterfaceType) {
      const fields = type.getFields();
      for (const [fieldName, field] of Object.entries(fields)) {
        const original = field.resolve ?? defaultFieldResolver;
        field.resolve = (source, args, context, info) => {
          recordFieldHit(typeName, fieldName);

          for (const argDef of field.args) {
            const value = args[argDef.name];
            if (value !== undefined) {
              recordArgHit(typeName, fieldName, argDef.name, value);
            }
            if (value != null && isInputObjectType(getNamedType(argDef.type))) {
              recordInputFieldHitsRecursive(schema, (getNamedType(argDef.type) as GraphQLInputObjectType).name, value);
            }
          }

          const result = original(source, args, context, info);

          if (result instanceof Promise) {
            return result.then((v) => {
              if (Array.isArray(v)) {
                for (const item of v) {
                  recordReturn(typeName, fieldName, item);
                }
              } else {
                recordReturn(typeName, fieldName, v);
              }
              return v;
            });
          }

          if (Array.isArray(result)) {
            for (const item of result) {
              recordReturn(typeName, fieldName, item);
            }
          } else {
            recordReturn(typeName, fieldName, result);
          }

          return result;
        };
      }
    }
  }
}

export function registerSchemaFileForCoverage(schemaFilePath: string): void {
  if (!process.env.VITEST) return;
  registeredFilePaths.add(schemaFilePath);
  registerExitHandler();
}

export function getHitData(): HitData {
  return {
    schemaFilePaths: Array.from(registeredFilePaths),
    fields: fieldHits,
    inputFields: inputFieldHits,
  };
}

// Reset internal state (for testing purposes)
export function _resetForTesting(): void {
  registeredFilePaths.clear();
  for (const key of Object.keys(fieldHits)) delete fieldHits[key];
  for (const key of Object.keys(inputFieldHits)) delete inputFieldHits[key];
  exitHandlerRegistered = false;
}
