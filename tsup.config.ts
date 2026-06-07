import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    postinstall: 'src/postinstall.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node24',
  splitting: false,
  sourcemap: true,
  external: ['@ethosagent/types'],
});
