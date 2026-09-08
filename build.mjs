/**
 * MomAI Desktop — build script (esbuild).
 * Bundles page and panel (ESM, react external — provided by the host).
 *
 * Usage:
 *   node build.mjs           — one-shot build
 *   node build.mjs --watch   — rebuild on source change (dev workflow)
 *
 * Note: in Dev (Symlinks) mode the host serves src/ directly, so a build is
 * only required for Store mode ("Testar Loja") and distribution.
 */
import { context } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const outdir = path.join(root, 'dist')
const isWatch = process.argv.includes('--watch')

const external = ['react', 'react-dom', 'react/jsx-runtime', 'momai:sdk']

const uiContexts = []
for (const entry of ['src/page.tsx', 'src/panel.tsx']) {
  const name = path.basename(entry, '.tsx')
  uiContexts.push(
    await context({
      entryPoints: [path.join(root, entry)],
      outfile: path.join(outdir, `${name}.js`),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      external,
      sourcemap: false,
      logLevel: 'warning',
    })
  )
}

async function buildAll() {
  await Promise.all(uiContexts.map((ctx) => ctx.rebuild()))
  console.log('[momai-desktop] build done')
}

await buildAll()

if (isWatch) {
  await Promise.all(uiContexts.map((ctx) => ctx.watch()))
  console.log('[momai-desktop] watching for changes…')
} else {
  await Promise.all(uiContexts.map((ctx) => ctx.dispose()))
}
