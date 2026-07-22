import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    // Lit's @property decorators need legacy class-field semantics or the
    // field definition shadows the reactive accessor (lit.dev/msg/class-field-shadowing).
    target: 'es2021',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    environment: 'happy-dom',
  },
});
