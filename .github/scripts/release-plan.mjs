#!/usr/bin/env node
/**
 * Works out which jars a release actually has to produce, and which Minecraft
 * versions each one covers.
 *
 *   node .github/scripts/release-plan.mjs            # human-readable plan
 *   node .github/scripts/release-plan.mjs --json     # the same plan as JSON
 *   node .github/scripts/release-plan.mjs --matrix   # GitHub Actions matrix
 *
 * The naive options are both bad. One jar per Minecraft version per loader would
 * put ~45 versions on Modrinth per release. One universal jar per loader is a lie
 * the moment a loader API moves, and they do: NeoForge replaced
 * BlockEvent.BreakEvent with BreakBlockEvent in Minecraft 26.1.2, and Forge moved
 * to EventBus 7 partway through the 1.21 line.
 *
 * So the grouping is derived rather than configured. Two targets share a jar when
 * both of these hold:
 *
 *   1. They compile from exactly the same source files. That is computed here with
 *      the same upto- overlay rule gradle/mod-sources.gradle uses, so adding an
 *      overlay automatically splits a group and nobody has to remember to update
 *      a list.
 *
 *   2. They are on the same side of the obfuscation boundary, for the loaders
 *      where that matters. Fabric remaps its jar to intermediary names and Forge
 *      reobfuscates to SRG, and neither of those name sets exists on the
 *      unobfuscated 26.x versions. NeoForge runs on official Mojang names the
 *      whole way and is exempt.
 *
 * Each group is built against its OLDEST member: that pins the output to the
 * lowest class-file version in the group (a Java 21 jar loads on the Java 25 JVM
 * Minecraft 26.x ships, not the other way round) and makes it impossible to
 * reference API that only the newer half has.
 */

import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'
import { compareVersions } from './discover-versions.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const LOADERS = {
  // dir:       the loader's build directory, relative to the repo root
  // field:     the versions.json field that carries this loader's version
  // reobfuscated: true when the published jar is remapped to names that only
  //            exist on the obfuscated 1.21.x versions, which forces a second jar
  //            for the 26.x line even when the source is identical
  neoforge: { dir: '.', field: 'neoforge', reobfuscated: false },
  forge: { dir: 'forge', field: 'forge', reobfuscated: true },
  fabric: { dir: 'fabric', field: 'fabric', reobfuscated: true }
}

/** Minecraft stopped being obfuscated when it switched to calendar versions. */
const isObfuscated = (minecraft) => minecraft.startsWith('1.')

async function listFiles (dir) {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return entries
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath ?? e.path, e.name))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/**
 * The same overlay rule as gradle/mod-sources.gradle: the lowest
 * src/versions/upto-<version> directory whose version is >= the target's.
 */
async function overlayRoot (loaderDir, minecraft) {
  const versionsDir = join(loaderDir, 'src', 'versions')
  let entries
  try {
    entries = await readdir(versionsDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  const candidates = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('upto-'))
    .map((e) => ({ name: e.name, limit: e.name.slice('upto-'.length) }))
    .filter((e) => compareVersions(minecraft, e.limit) <= 0)
    .sort((a, b) => compareVersions(a.limit, b.limit))
  return candidates.length > 0 ? join(versionsDir, candidates[0].name, 'java') : null
}

/**
 * A digest of every source file that would be compiled for this loader at this
 * Minecraft version. Two targets with the same digest produce the same bytecode,
 * so one jar can serve both.
 */
async function sourceDigest (loaderDir, minecraft) {
  const roots = [join(ROOT, 'common', 'java'), join(loaderDir, 'src', 'main', 'java')]
  const sources = new Map()
  for (const root of roots) {
    for (const file of await listFiles(root)) {
      sources.set(relative(root, file).split(sep).join('/'), file)
    }
  }
  const overlay = await overlayRoot(loaderDir, minecraft)
  if (overlay) {
    for (const file of await listFiles(overlay)) {
      // Replaces the base file rather than adding to it, exactly as the Gradle
      // side does with its exclude filter.
      sources.set(relative(overlay, file).split(sep).join('/'), file)
    }
  }

  const hash = createHash('sha256')
  for (const key of [...sources.keys()].sort()) {
    hash.update(key)
    hash.update('\0')
    hash.update(await readFile(sources.get(key)))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 12)
}

export async function buildPlan () {
  const { targets, fabric_loader: fabricLoader } =
    JSON.parse(await readFile(join(ROOT, 'versions.json'), 'utf8'))
  const modVersion = /^mod_version=(.*)$/m
    .exec(await readFile(join(ROOT, 'gradle.properties'), 'utf8'))?.[1]
    ?.trim()
  if (!modVersion) throw new Error('Could not read mod_version from gradle.properties')

  const groups = new Map()
  for (const [loader, config] of Object.entries(LOADERS)) {
    const loaderDir = join(ROOT, config.dir)
    for (const target of targets) {
      const loaderVersion = target[config.field]
      if (!loaderVersion) continue
      const era = config.reobfuscated ? (isObfuscated(target.minecraft) ? 'obf' : 'plain') : 'any'
      const key = `${loader}:${era}:${await sourceDigest(loaderDir, target.minecraft)}`
      if (!groups.has(key)) groups.set(key, { loader, members: [] })
      groups.get(key).members.push({ minecraft: target.minecraft, loaderVersion })
    }
  }

  return [...groups.values()]
    .map(({ loader, members }) => {
      members.sort((a, b) => compareVersions(a.minecraft, b.minecraft))
      const oldest = members[0]
      const newest = members[members.length - 1]
      const range = oldest.minecraft === newest.minecraft
        ? oldest.minecraft
        : `${oldest.minecraft}-${newest.minecraft}`
      return {
        loader,
        // The target the jar is COMPILED against: the oldest in the group.
        minecraft: oldest.minecraft,
        loader_version: oldest.loaderVersion,
        fabric_loader: loader === 'fabric' ? fabricLoader : '',
        game_versions: members.map((m) => m.minecraft),
        // NEWLINE separated, not comma separated. mc-publish declares
        // game-versions as string[] and splits array inputs on /\r?\n/, so a
        // comma separated value is never split: the whole string is handed to the
        // Minecraft version provider as a version *range*, "1.21.1,1.21.3,..."
        // does not parse as one, and an unparseable range matches nothing --
        // leaving zero game versions and failing inside mc-publish with "At least
        // one game version should be specified", despite the input having looked
        // perfectly populated in the run log.
        game_versions_text: members.map((m) => m.minecraft).join('\n'),
        range,
        // Unique per group and stable across releases as long as the group is:
        // Modrinth rejects a duplicate version_number, and all of a release's
        // jars go up under the same mod_version.
        version_number: `${modVersion}+${loader}-mc${oldest.minecraft}`,
        name: `v${modVersion} - ${loader} (Minecraft ${range})`,
        // Where the loader's build drops its jar, and what to stage it as so the
        // GitHub release can carry every jar without name collisions.
        jar_glob: jarGlob(loader),
        artifact: `only_silk_touch_enderchest-${loader}-mc${oldest.minecraft}`
      }
    })
    .sort((a, b) => a.loader.localeCompare(b.loader) || compareVersions(a.minecraft, b.minecraft))
}

function jarGlob (loader) {
  return LOADERS[loader].dir === '.' ? 'build/libs/*.jar' : `${LOADERS[loader].dir}/build/libs/*.jar`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plan = await buildPlan()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(plan, null, 2))
  } else if (process.argv.includes('--matrix')) {
    console.log(JSON.stringify({ include: plan }))
  } else {
    console.log(`${plan.length} jar${plan.length === 1 ? '' : 's'} to publish:\n`)
    for (const group of plan) {
      console.log(`  ${group.loader.padEnd(9)} build against ${group.minecraft.padEnd(9)} (${group.loader_version})`)
      console.log(`  ${''.padEnd(9)} covers ${group.game_versions.length}: ${group.game_versions.join(', ')}`)
      console.log(`  ${''.padEnd(9)} as ${group.version_number}\n`)
    }
  }
}
