import { defineConfig, type Plugin } from 'vite';

/**
 * Extension pages are served from chrome-extension:// or moz-extension://.
 * `crossorigin` attributes add nothing there and have tripped up Firefox in
 * the past, so strip them from the generated index.html.
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(=(["'])[^"']*\2)?/g, '');
    },
  };
}

export default defineConfig({
  // Relative asset URLs so dist/ works from any extension origin.
  base: './',
  // public/ holds manifest.json + icons; Vite copies it verbatim into dist/.
  publicDir: 'public',
  plugins: [stripCrossorigin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 0,
    // No inline polyfill script: keeps the page compatible with MV3's CSP.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: 'index.html',
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: { port: 5173 },
});
