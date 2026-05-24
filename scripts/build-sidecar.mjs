#!/usr/bin/env node
// Bundle the Node helper into a standalone Windows executable for use as a Tauri
// sidecar (externalBin). Pipeline:
//
//   esbuild   helper/index.mjs (ESM + busboy)  →  dist-sidecar/helper.cjs (one CJS file)
//   @yao-pkg/pkg  helper.cjs + embedded Node    →  haspel-helper.exe
//   rename    →  src-tauri/binaries/haspel-helper-<rustc-host-triple>.exe
//
// Tauri's externalBin requires the per-platform binary be suffixed with the
// target triple. The helper reads its read-only catalog/demo seed from
// PROJECT_ROOT at runtime (Tauri sets it to the resource dir) — nothing is
// embedded in the exe — so no pkg "assets" config is needed.
//
// Run:  node scripts/build-sidecar.mjs   (also wired as app/ script "build:sidecar")

import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const HELPER = path.join(REPO, 'helper', 'index.mjs')
const OUT_DIR = path.join(REPO, 'dist-sidecar')
const CJS = path.join(OUT_DIR, 'helper.cjs')
const BIN_DIR = path.join(REPO, 'src-tauri', 'binaries')

const isWin = process.platform === 'win32'
const binExt = isWin ? '.cmd' : ''
const pkgBin = path.join(REPO, 'app', 'node_modules', '.bin', 'pkg' + binExt)

// Load esbuild's JS API from app/node_modules (the script lives outside app/).
// Using the JS API avoids passing the banner (which contains spaces) through a
// Windows .cmd shim, where cmd would re-split it and break the build.
const requireFromApp = createRequire(path.join(REPO, 'app', 'package.json'))

// rustc host target triple (e.g. x86_64-pc-windows-msvc) — what Tauri expects.
function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8', shell: isWin })
  const m = out.match(/host:\s*(\S+)/)
  if (!m) throw new Error('could not parse rustc host triple from `rustc -vV`')
  return m[1]
}

// Map the rustc triple → a pkg --targets value (node<major>-<os>-<arch>).
function pkgTarget(triple) {
  const arch = triple.includes('aarch64') ? 'arm64' : 'x64'
  let os
  if (triple.includes('windows')) os = 'win'
  else if (triple.includes('apple') || triple.includes('darwin')) os = 'macos'
  else os = 'linux'
  return `node22-${os}-${arch}`
}

async function main() {
  if (!existsSync(pkgBin)) throw new Error(`@yao-pkg/pkg not found at ${pkgBin} — run: npm i -D @yao-pkg/pkg --prefix app`)
  const esbuild = requireFromApp('esbuild')

  const triple = hostTriple()
  const target = pkgTarget(triple)
  const exe = path.join(BIN_DIR, `haspel-helper-${triple}${isWin ? '.exe' : ''}`)

  console.log(`[sidecar] host triple : ${triple}`)
  console.log(`[sidecar] pkg target  : ${target}`)
  console.log(`[sidecar] output      : ${exe}`)

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(BIN_DIR, { recursive: true })

  // esbuild: ESM helper (+ busboy) → one self-contained CJS file pkg can wrap.
  // The helper derives __dirname from `import.meta.url`, which is empty under
  // the CJS output format (and would make fileURLToPath() throw at startup).
  // Define it from __filename (always available in CJS) via a banner so the
  // bundled helper boots cleanly; PROJECT_ROOT is still overridden by the env
  // Tauri sets, so this only matters for not crashing on load.
  console.log('\n[sidecar] esbuild bundling helper → CJS…')
  await esbuild.build({
    entryPoints: [HELPER],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: CJS,
    define: { 'import.meta.url': '__IMPORT_META_URL__' },
    banner: { js: 'const __IMPORT_META_URL__ = require("url").pathToFileURL(__filename).href;' },
    logLevel: 'info',
  })

  // pkg: CJS + embedded Node runtime → standalone exe.
  console.log('\n[sidecar] pkg → standalone exe…')
  execFileSync(pkgBin, [CJS, '--targets', target, '--output', exe, '--compress', 'GZip'], {
    stdio: 'inherit',
    shell: isWin,
  })

  console.log(`\n[sidecar] done → ${exe}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
