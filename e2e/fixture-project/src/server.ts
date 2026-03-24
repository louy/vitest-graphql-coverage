import { buildSchema } from 'graphql';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { registerSchemaForCoverage } from '../../../dist/register.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const schemaPath = path.join(__dirname, '..', 'schema.graphql');

const typeDefs = readFileSync(schemaPath, 'utf8');
export const schema = buildSchema(typeDefs);

const users = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: null },
];

export const rootValue = {
  user: ({ id }: { id: string }) => users.find((u) => u.id === id) ?? null,
  users: (_args: { filter?: { name?: string; active: boolean } }) => users,
  ping: () => 'pong',
};

registerSchemaForCoverage(schema, schemaPath);
