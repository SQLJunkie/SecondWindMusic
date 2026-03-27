# Second Wind Music Productions — Website

Modern Astro site for [secondwindmusic.com](https://secondwindmusic.com), built for free hosting on **Cloudflare Pages**.

## Quick Start (on your local machine)

```bash
cd secondwindmusic-astro
npm install
npm run dev        # local preview at http://localhost:4321
npm run build      # builds to ./dist/
```

## Deploying to Cloudflare Pages (free)

### Option A — Connect to GitHub (recommended, auto-deploys on every push)

1. Push this folder to a GitHub repository.
2. Go to [Cloudflare Pages](https://pages.cloudflare.com) → **Create a project** → **Connect to Git**.
3. Select your repository.
4. Set the build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. Click **Save and Deploy**. That's it — Cloudflare handles the build and CDN.

### Option B — Direct Upload (no GitHub needed)

1. Run `npm run build` locally.
2. Go to [Cloudflare Pages](https://pages.cloudflare.com) → **Create a project** → **Direct Upload**.
3. Upload the contents of the `dist/` folder.

## Adding Videos to the Media Page

Open `src/pages/media.astro` and find the `videos` array at the top.
Replace each empty `embedUrl` with a real YouTube or Vimeo embed URL:

```js
// YouTube example:
embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ"

// Vimeo example:
embedUrl: "https://player.vimeo.com/video/123456789"
```

Also change `placeholder: true` to `placeholder: false` for each video you add.

## Adding Portfolio Items

Open `src/pages/portfolio.astro` and edit the `artists` array.
Add new images to `public/images/` and reference them there.

## File Structure

```
secondwindmusic-astro/
├── public/
│   ├── images/           ← logo, montage, artist photos
│   └── _redirects        ← Cloudflare Pages URL redirects
├── src/
│   ├── components/
│   │   ├── Nav.astro
│   │   └── Footer.astro
│   ├── layouts/
│   │   └── Layout.astro  ← shared HTML shell
│   ├── pages/
│   │   ├── index.astro   ← Home
│   │   ├── portfolio.astro
│   │   ├── media.astro
│   │   └── contact.astro
│   └── styles/
│       └── global.css
├── astro.config.mjs
└── package.json
```
