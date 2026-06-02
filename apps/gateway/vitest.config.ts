import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      thresholds: { lines: 80 },
      include: ['src/lib/**/*.ts', 'src/app/api/**/*.ts'],
    },
  },
});
