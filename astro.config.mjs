import { defineConfig } from 'astro/config';

// Static output — works with Cloudflare Pages out of the box.
// No adapter needed for a fully static site.
export default defineConfig({
  output: 'static',
  site: 'https://secondwindmusic.com',
});
