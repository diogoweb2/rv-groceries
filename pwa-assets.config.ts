import { defineConfig } from '@vite-pwa/assets-generator/config'

// The source icon (public/favicon.svg) is full-bleed art with its own sky
// background and the rig kept inside the maskable safe zone, so every output
// is generated with zero padding and no injected background.
export default defineConfig({
  images: ['public/favicon.svg'],
  preset: {
    // favicon.ico is NOT generated here: it's a hand-built transparent
    // trailer-only icon rendered from public/favicon-trailer.svg.
    transparent: {
      sizes: [64, 192, 512],
      padding: 0,
    },
    maskable: {
      sizes: [512],
      padding: 0,
    },
    apple: {
      sizes: [180],
      padding: 0,
    },
  },
})
