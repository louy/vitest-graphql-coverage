import { defineConfig } from 'vitest/config';
import GraphQLCoverageReporter from 'vitest-graphql-coverage/reporter';

export default defineConfig({
  test: {
    server: { deps: { inline: ['vitest-graphql-coverage'] } },
    reporters: [new GraphQLCoverageReporter()],
    coverage: {
      provider: 'v8',
      reporter: ['json'],
      reportsDirectory: './coverage',
    },
  },
});
