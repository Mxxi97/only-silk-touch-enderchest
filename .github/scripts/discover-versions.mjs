#!/usr/bin/env node
/**
 * Discovers every Minecraft version this mod should be built against, on every
 * loader, and writes versions.json (plus the supported-versions table in
 * README.md).
 *
 *   node .github/scripts/discover-versions.mjs           # rewrite versions.json + README
 *   node .github/scripts/discover-versions.mjs --check   # exit 1 if they are stale
 *   node .github/scripts/discover-versions.mjs --check --soft   # ...but exit 0
 *
 * The Minecraft version list comes from Mojang's own manifest rather than from a
 * loader, because the three loaders ship at different times and whichever one is
 * fastest should not decide what the other two are asked about. A Minecraft
 * version becomes a target as soon as ANY loader supports it; the per-loader
 * fields are null until that loader catches up.
 *
 * The awkward part this handles: Minecraft changed its version scheme partway
 * through the supported range. The 1.21.x line ran to 1.21.11, then Mojang
 * switched to calendar versions (26.1, 26.2, 26.3), and NeoForge followed by
 * going from three-component versions (21.8.54) to four (26.2.0.88). So there is
 * no arithmetic rule mapping a NeoForge version to its Minecraft version;
 * instead it is read out of the NeoForge POM, which declares a dependency on
 * net.neoforged:neoform:<minecraftVersion>-<suffix>. Forge needs no such trick --
 * its coordinates are literally "<minecraft>-<forge>".
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const NEOFORGE_VERSIONS =
  'https://maven.neoforged.net/api/maven/versions/releases/net%2Fneoforged%2Fneoforge'
const NEOFORGE_POM = (v) =>
  `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}.pom`
const FORGE_METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
const PARCHMENT_METADATA = (mc) =>
  `https://maven.parchmentmc.org/org/parchmentmc/data/parchment-${mc}/maven-metadata.xml`
const MODDEV_METADATA =
  'https://plugins.gradle.org/m2/net/neoforged/moddev/net.neoforged.moddev.gradle.plugin/maven-metadata.xml'
const FABRIC_LOADER_META = 'https://meta.fabricmc.net/v2/versions/loader'
// P7dR8mSH is the immutable Modrinth project id of Fabric API.
const FABRIC_API_VERSIONS = (mc) =>
  `https://api.modrinth.com/v2/project/P7dR8mSH/version?game_versions=${encodeURIComponent(`["${mc}"]`)}&loaders=${encodeURIComponent('["fabric"]')}`

// Minecraft 1.21.1 is the floor the mod promises; never regress below it.
const FLOOR = '1.21.1'
// The NeoForge series for Minecraft 1.21.1. Applied before any POM is fetched:
// older NeoForge releases do not declare a neoform dependency at all, so reading
// their Minecraft version would throw, and resolving hundreds of dead series
// would make a scheduled run needlessly slow.
const NEOFORGE_FLOOR_SERIES = '21.1'

const VERSIONS_JSON = fileURLToPath(new URL('../../versions.json', import.meta.url))
const README = fileURLToPath(new URL('../../README.md', import.meta.url))
const README_START = '<!-- versions:start -->'
const README_END = '<!-- versions:end -->'

async function get (url, { optional = false } = {}) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'only-silk-touch-enderchest-ci' } })
      if (response.status === 404 && optional) return null
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
      return await response.text()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  if (optional) return null
  throw lastError
}

/**
 * Component-wise numeric compare. This is the one ordering used everywhere --
 * including by gradle/mod-sources.gradle when it resolves an upto- overlay -- and
 * it survives the switch to calendar versions for free, because 1 sorts below 26.
 */
export function compareVersions (a, b) {
  const parts = (v) => v.split('.').map((p) => Number(p) || 0)
  const left = parts(a)
  const right = parts(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Every stable Minecraft release at or above the floor, oldest first. */
async function minecraftReleases () {
  const manifest = JSON.parse(await get(MOJANG_MANIFEST))
  return manifest.versions
    .filter((v) => v.type === 'release')
    .map((v) => v.id)
    .filter((id) => /^\d+(\.\d+)*$/.test(id) && compareVersions(id, FLOOR) >= 0)
    .sort(compareVersions)
}

/**
 * Splits a NeoForge version into its series and build number. The series is
 * everything except the final component, which makes this work unchanged across
 * both version schemes: 21.1.250 -> series 21.1, 26.2.0.88 -> series 26.2.0.
 */
function parseNeoVersion (version) {
  const match = /^(\d+(?:\.\d+)*)\.(\d+)(-beta)?$/.exec(version)
  if (!match) return null
  return { version, series: match[1], build: Number(match[2]), beta: Boolean(match[3]) }
}

/** Latest build in a series, preferring a stable release over a beta. */
function pickBest (candidates) {
  const stable = candidates.filter((c) => !c.beta)
  const pool = stable.length > 0 ? stable : candidates
  return pool.reduce((best, c) => (c.build > best.build ? c : best))
}

/**
 * Reads the Minecraft version out of a NeoForge POM via its neoform dependency,
 * e.g. neoform 1.21.8-20250717.133445 -> 1.21.8, neoform 26.2-2 -> 26.2.
 */
async function minecraftVersionFor (neoVersion) {
  const pom = await get(NEOFORGE_POM(neoVersion))
  for (const [, body] of pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    if (!/<artifactId>\s*neoform\s*<\/artifactId>/.test(body)) continue
    const version = /<version>\s*([^<\s]+)\s*<\/version>/.exec(body)?.[1]
    if (!version) break
    const stripped = /^(.*)-(?:\+|\d{8}\.\d{6}|\d+)$/.exec(version)
    return stripped ? stripped[1] : version
  }
  throw new Error(`Could not find a neoform dependency in the POM for NeoForge ${neoVersion}`)
}

/** Minecraft version -> { version, beta } for the newest NeoForge build of each series. */
async function neoforgeByMinecraft () {
  const listing = JSON.parse(await get(NEOFORGE_VERSIONS))
  const bySeries = new Map()
  for (const parsed of (listing.versions ?? []).map(parseNeoVersion)) {
    if (!parsed) continue
    if (compareVersions(parsed.series, NEOFORGE_FLOOR_SERIES) < 0) continue
    if (!bySeries.has(parsed.series)) bySeries.set(parsed.series, [])
    bySeries.get(parsed.series).push(parsed)
  }

  const result = new Map()
  for (const candidates of bySeries.values()) {
    const best = pickBest(candidates)
    const minecraft = await minecraftVersionFor(best.version)
    if (compareVersions(minecraft, FLOOR) < 0) continue
    // Two NeoForge series can map to the same Minecraft version; keep the newer.
    const existing = result.get(minecraft)
    if (!existing || compareVersions(best.version, existing.version) > 0) {
      result.set(minecraft, { version: best.version, beta: best.beta })
    }
  }
  return result
}

/**
 * Minecraft version -> newest full Forge coordinate ("1.21.1-52.1.16"). Forge
 * puts the Minecraft version in the coordinate, so no POM lookup is needed.
 */
async function forgeByMinecraft () {
  const xml = await get(FORGE_METADATA)
  const result = new Map()
  for (const [, version] of xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)) {
    const split = version.indexOf('-')
    if (split < 0) continue
    const minecraft = version.slice(0, split)
    const build = version.slice(split + 1)
    if (!/^\d+(\.\d+)*$/.test(minecraft) || !/^\d+(\.\d+)*$/.test(build)) continue
    if (compareVersions(minecraft, FLOOR) < 0) continue
    const existing = result.get(minecraft)
    if (!existing || compareVersions(build, existing.build) > 0) {
      result.set(minecraft, { version, build })
    }
  }
  return new Map([...result].map(([minecraft, { version }]) => [minecraft, version]))
}

/**
 * Latest Fabric API build for a Minecraft version, from Modrinth. Fabric itself
 * supports every Minecraft version from day one; what actually gates a target is
 * a Fabric API build for it. The listing is newest-first.
 */
async function fabricApiVersionFor (minecraft) {
  const versions = JSON.parse(await get(FABRIC_API_VERSIONS(minecraft)))
  return versions[0]?.version_number ?? null
}

/** Latest stable Fabric loader. One loader serves every Minecraft version. */
async function fabricLoaderVersion () {
  const listing = JSON.parse(await get(FABRIC_LOADER_META))
  return listing.find((entry) => entry.stable)?.version ?? null
}

function latestFromMavenMetadata (xml) {
  if (!xml) return null
  const release = /<release>\s*([^<\s]+)\s*<\/release>/.exec(xml)?.[1]
  if (release) return release
  const all = [...xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)].map((m) => m[1])
  return all.length > 0 ? all[all.length - 1] : null
}

/** Parchment is dev-time only, and is not published for the 26.x versions at all. */
async function parchmentFor (minecraft) {
  return latestFromMavenMetadata(await get(PARCHMENT_METADATA(minecraft), { optional: true }))
}

async function discover () {
  const [releases, neoforge, forge] = await Promise.all([
    minecraftReleases(),
    neoforgeByMinecraft(),
    forgeByMinecraft()
  ])

  const targets = []
  for (const minecraft of releases) {
    const neo = neoforge.get(minecraft) ?? null
    const forgeVersion = forge.get(minecraft) ?? null
    const fabric = await fabricApiVersionFor(minecraft)
    // A Minecraft version nobody supports yet is not a target. It will become one
    // on a later run, as soon as the first loader ships for it.
    if (!neo && !forgeVersion && !fabric) continue
    targets.push({
      minecraft,
      neoforge: neo?.version ?? null,
      forge: forgeVersion,
      fabric,
      beta: neo?.beta ?? false,
      parchment: await parchmentFor(minecraft)
    })
  }

  return {
    moddev_version: latestFromMavenMetadata(await get(MODDEV_METADATA)) ?? '2.0.147',
    fabric_loader: (await fabricLoaderVersion()) ?? '0.19.5',
    targets
  }
}

function renderReadmeTable (data) {
  const mark = (value) => (value ? 'yes' : '—')
  const rows = data.targets
    .slice()
    .reverse()
    .map((t) => `| ${t.minecraft}${t.beta ? ' (beta)' : ''} | ${mark(t.neoforge)} | ${mark(t.forge)} | ${mark(t.fabric)} |`)
  return [
    README_START,
    '',
    '| Minecraft | NeoForge | Forge | Fabric |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    README_END
  ].join('\n')
}

async function updateReadme (data) {
  const readme = await readFile(README, 'utf8')
  const table = renderReadmeTable(data)
  const start = readme.indexOf(README_START)
  const end = readme.indexOf(README_END)
  if (start === -1 || end === -1) {
    return readme.trimEnd() + '\n\n## Supported versions\n\n' + table + '\n'
  }
  return readme.slice(0, start) + table + readme.slice(end + README_END.length)
}

/** Lets the scheduled workflow branch on the result without re-parsing stdout. */
async function emitGithubOutput (values) {
  if (!process.env.GITHUB_OUTPUT) return
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n')
  await writeFile(process.env.GITHUB_OUTPUT, lines + '\n', { flag: 'a' })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  const data = await discover()
  const serialised = JSON.stringify(data, null, 2) + '\n'
  const readme = await updateReadme(data)

  if (check) {
    const currentJson = await readFile(VERSIONS_JSON, 'utf8').catch(() => '')
    const currentReadme = await readFile(README, 'utf8').catch(() => '')
    if (currentJson === serialised && currentReadme === readme) {
      console.log(`versions.json is up to date (${data.targets.length} targets).`)
      await emitGithubOutput({ stale: false, added: '[]', fabric_loader: data.fabric_loader })
      process.exit(0)
    }

    // What lands in `added` decides what gets try-built AND whether a release is
    // cut, so the key is chosen deliberately: only a change in what PLAYERS can
    // install is release-worthy -- a new Minecraft version, or a loader gaining
    // or losing support for one. A loader build bump (NeoForge 21.1.251 ->
    // 21.1.252, a new Forge build, a new Fabric API) changes nothing in the
    // published jar, because each jar is compiled against the oldest member of
    // its group and Modrinth lists game versions and loaders, not loader build
    // numbers. Releasing on those would put a version on Modrinth every few days
    // with nothing in it. They flow through the workflow's metadata-only commit
    // path instead, so versions.json still stays current.
    const key = (t) => `${t.minecraft}|${t.neoforge != null}|${t.forge != null}|${t.fabric != null}`
    const known = new Set(JSON.parse(currentJson || '{"targets":[]}').targets.map(key))
    const added = data.targets.filter((t) => !known.has(key(t)))
    console.log('versions.json is out of date.')
    for (const target of added) {
      console.log(`  new coverage: Minecraft ${target.minecraft} (neoforge ${target.neoforge ?? '-'}, forge ${target.forge ?? '-'}, fabric ${target.fabric ?? '-'})`)
    }
    if (added.length === 0) console.log('  metadata only -- nothing release-worthy.')
    // fabric_loader rides along because try-build needs it for fabric targets and
    // cannot read it from versions.json -- the checkout still has the OLD file.
    await emitGithubOutput({ stale: true, added: JSON.stringify(added), fabric_loader: data.fabric_loader })
    // The scheduled workflow treats a non-zero exit as "there is work to do", so
    // it only signals staleness when asked to fail.
    process.exit(process.argv.includes('--soft') ? 0 : 1)
  }

  await writeFile(VERSIONS_JSON, serialised)
  await writeFile(README, readme)
  console.log(`Wrote versions.json with ${data.targets.length} targets.`)
  for (const t of data.targets) {
    console.log(`  ${t.minecraft.padEnd(9)} neoforge ${String(t.neoforge ?? '-').padEnd(16)} forge ${String(t.forge ?? '-').padEnd(18)} fabric ${t.fabric ?? '-'}`)
  }
}
