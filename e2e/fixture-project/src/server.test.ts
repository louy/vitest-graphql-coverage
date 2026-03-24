import { describe, it, expect } from 'vitest';
import { graphql } from 'graphql';
import { schema, rootValue } from './server.js';

// Intentionally exercises user + users but NOT ping, and never passes UserFilter,
// so those remain at zero coverage — verifiable by the e2e test.

describe('server', () => {
  it('resolves a user by id', async () => {
    const result = await graphql({
      schema,
      source: '{ user(id: "1") { id name email } }',
      rootValue,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.user).toMatchObject({ id: '1', name: 'Alice' });
  });

  it('resolves the users list', async () => {
    const result = await graphql({
      schema,
      source: '{ users { id name } }',
      rootValue,
    });
    expect(result.errors).toBeUndefined();
    expect((result.data?.users as unknown[]).length).toBe(2);
  });
});
