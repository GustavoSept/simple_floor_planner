import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build so dist/index.html opens directly via file:// with no server.
export default defineConfig({
  plugins: [viteSingleFile()],
  base: './',
  build: { target: 'es2020' },
});
