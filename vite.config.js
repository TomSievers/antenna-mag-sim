import { defineConfig } from 'vite';

// VITE_BASE_URL is set by the GitHub Actions workflow to '/<repo-name>/'
// For local dev and Docker, it defaults to '/'
export default defineConfig({
  base: process.env.VITE_BASE_URL ?? '/',
});
