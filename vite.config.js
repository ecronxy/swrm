import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), svgr(), tailwindcss()],
  resolve: { dedupe: ['react', 'react-dom'] },
  // The kit's deps are prebundled, otherwise dev ends up with two copies of React.
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'motion/react', 'motion/react-m', 'calligraph', 'markdown-to-jsx', '@lisse/react', '@lisse/core', 'clsx', 'prop-types'],
  },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://127.0.0.1:4141', ws: true }, '/att': { target: 'http://127.0.0.1:4141' } },
  },
});
