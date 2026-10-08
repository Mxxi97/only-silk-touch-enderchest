#!/usr/bin/env node
/**
 * Builds the mod against every target in versions.json, on every loader that
 * supports it, one Gradle invocation at a time, and prints a pass/fail table.
 * This is the same coverage CI gives you, without having to push.
 *
 *   node .github/scripts/build-all.mjs                   # everything
 *   node .github/scripts/build-all.mjs --loader fabric   # one loader (repeatable)
 *   node .github/scripts/build-all.mjs --only 1.21.1     # one Minecraft version (repeatable)
 *   node .github/scripts/build-all.mjs --no-parchment    # skip dev-time mappings (faster)
 *
 * Exits non-zero if any build failed.
 */

import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { platform } from 'node:process'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WINDOWS = platform === 'win32'
// cmd.exe does not resolve a bare gradlew.bat from the working directory, and Node
// will not spawn a .bat at all without a shell, so pass a quoted absolute path.
const GRADLEW = WINDOWS ? `"${join(ROOT, 'gradlew.bat')}"` : './gradlew'

const repeated = (flag) => process.argv.reduce((acc, arg, i, all) => {
  if (arg === flag && all[i + 1]) acc.push(all[i + 1])
  return acc
}, [])

const only = repeated('--only')
const loaders = repeated('--loader')
const useParchment = !process.argv.includes('--no-parchment')

/**
 * The Gradle invocation for one (target, loader) pair. Each loader is a separate
 * standalone build, reached through this same wrapper with -p.
 */
function commandFor (target, loader, fabricLoader) {
  if (loader === 'neoforge') {
    const args = ['build', `-Pneo_version=${target.neoforge}`]
    // Parchment only decorates the decompiled Minecraft sources, so it never
    // affects the jar -- but it makes local debugging far more readable. Both
    // properties must be set together or ModDevGradle throws.
    if (useParchment && target.parchment) {
      args.push(`-PneoForge.parchment.minecraftVersion=${target.minecraft}`)
      args.push(`-PneoForge.parchment.mappingsVersion=${target.parchment}`)
    }
    return args
  }
  if (loader === 'forge') {
    return ['-p', 'forge', 'build', `-Pforge_version=${target.forge}`]
  }
  return ['-p', 'fabric', 'build',
    `-Pminecraft_version=${target.minecraft}`,
    `-Pfabric_api_version=${target.fabric}`,
    `-Ploader_version=${fabricLoader}`]
}

function run (args) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(GRADLEW, args, { cwd: ROOT, stdio: 'inherit', shell: WINDOWS })
    let spawnError = null
    child.on('error', (error) => { spawnError = error })
    child.on('close', (code) => {
      if (spawnError) console.error(`Could not run Gradle: ${spawnError.message}`)
      resolve({ ok: code === 0 && !spawnError, seconds: Math.round((Date.now() - started) / 1000) })
    })
  })
}

const { targets, fabric_loader: fabricLoader } =
  JSON.parse(await readFile(new URL('../../versions.json', import.meta.url), 'utf8'))

const jobs = []
for (const target of targets) {
  if (only.length > 0 && !only.includes(target.minecraft)) continue
  for (const loader of ['neoforge', 'forge', 'fabric']) {
    if (loaders.length > 0 && !loaders.includes(loader)) continue
    if (!target[loader]) continue
    jobs.push({ target, loader })
  }
}

if (jobs.length === 0) {
  console.error('No builds matched the given filters.')
  process.exit(1)
}

const results = []
for (const [index, job] of jobs.entries()) {
  console.log(`\n=== [${index + 1}/${jobs.length}] Minecraft ${job.target.minecraft} / ${job.loader} ===\n`)
  results.push({ ...job, ...(await run(commandFor(job.target, job.loader, fabricLoader))) })
}

console.log('\n================ summary ================')
for (const { target, loader, ok, seconds } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${target.minecraft.padEnd(9)} ${loader.padEnd(9)} ${seconds}s`)
}

const failed = results.filter((r) => !r.ok)
if (failed.length > 0) {
  console.log(`\n${failed.length} of ${results.length} builds failed.`)
  console.log('To patch the versions a loader API change broke, put a replacement file in')
  console.log('<loader>/src/versions/upto-<lastBrokenMinecraftVersion>/java/ -- see gradle/mod-sources.gradle.')
  process.exit(1)
}
console.log(`\nAll ${results.length} builds passed.`)
