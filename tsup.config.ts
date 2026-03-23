import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    register: 'src/register.ts',
    reporter: 'src/reporter.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
});
