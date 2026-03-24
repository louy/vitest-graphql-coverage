import { defineConfig } from 'vitest/config';
import GraphQLCoverageReporter from '../../dist/reporter.js';

export default defineConfig({
  test: {
    pool: 'forks',
    reporters: [new GraphQLCoverageReporter()],
    coverage: {
      provider: 'v8',
      reporter: ['json'],
      reportsDirectory: './coverage',
    },
  },
});
