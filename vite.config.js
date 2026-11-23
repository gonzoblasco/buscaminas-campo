import { defineConfig } from 'vite';

// `base: './'` makes every asset URL relative, so the build works whether it is
// served from a domain root or from a project subpath like
// https://<user>.github.io/<repo>/. Without it the HTML asks for /assets/...,
// which 404s on Pages while the file sits happily at /<repo>/assets/... and the
// page loads blank with no console error to explain it.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
});
