# Only Silk Touch Enderchest

A Minecraft mod that refuses to let you mine an ender chest unless you are holding
a tool with Silk Touch.

Vanilla lets you break an ender chest with anything. Without Silk Touch it does not
drop itself — it shatters into 8 obsidian, and the chest is gone. This mod simply
denies the break instead, so a mis-aimed pickaxe costs you nothing.

- Any level of Silk Touch counts, including levels a datapack or another mod adds.
- Creative mode is exempt, so you can still clean up.
- The contents of an ender chest are tied to the player, not the block, so nothing
  is ever lost either way — this is about not losing the chest itself.

Runs on **Fabric**, **Forge** and **NeoForge**, from Minecraft 1.21.1 onwards. The
mod has to be installed on the server (or on your world in single-player); it is
the server that decides whether a block may be broken.

## Supported versions

<!-- versions:start -->

| Minecraft | NeoForge | Forge | Fabric |
| --- | --- | --- | --- |
| 26.3 (beta) | yes | yes | yes |
| 26.2 | yes | yes | yes |
| 26.1.2 | yes | yes | yes |
| 26.1.1 (beta) | yes | yes | yes |
| 26.1 (beta) | yes | yes | yes |
| 1.21.11 | yes | yes | yes |
| 1.21.10 | yes | yes | yes |
| 1.21.9 (beta) | yes | yes | yes |
| 1.21.8 | yes | yes | yes |
| 1.21.7 (beta) | yes | yes | yes |
| 1.21.6 (beta) | yes | yes | yes |
| 1.21.5 | yes | yes | yes |
| 1.21.4 | yes | yes | yes |
| 1.21.3 | yes | yes | yes |
| 1.21.2 (beta) | yes | — | yes |
| 1.21.1 | yes | yes | yes |

<!-- versions:end -->

This table and `versions.json` are regenerated daily by
[`update-versions.yml`](.github/workflows/update-versions.yml), which checks
Mojang, NeoForge, Forge and Fabric for anything new, proves the mod still compiles
against it, and only then publishes.

## Repository layout

The rule itself is about twenty lines and lives in exactly one place. Everything
else is the machinery for shipping it across three loaders and an open-ended range
of Minecraft versions.

| Path | What it is |
| --- | --- |
| `common/java/` | The rule. Shared by all three loaders; only Minecraft API. |
| `src/` | The NeoForge build (the repo root is the NeoForge project). |
| `forge/` | The MinecraftForge build. Standalone Gradle build. |
| `fabric/` | The Fabric build. Standalone Gradle build. |
| `gradle/mod-sources.gradle` | Shared source-set wiring and the version-overlay rule. |
| `versions.json` | Every supported Minecraft version and the loader builds for it. |
| `.github/scripts/` | Version discovery, release planning, version bumping, local build-all. |

The three loaders cannot be subprojects of one another: Loom, ModDevGradle and
ForgeGradle each rewire the Minecraft dependency for an entire Gradle build. They
are separate builds driven through the one wrapper at the repo root.

### Per-version overlays

`src/main/java` in each loader targets the **newest** supported Minecraft version,
so a new Minecraft release usually needs no change at all. Versions whose loader
API has since moved are covered by a directory named

```
<loader>/src/versions/upto-<minecraftVersion>/java/
```

which replaces same-named files for every Minecraft version at or below that one.
There are two of these today, both for loader API changes rather than Minecraft
ones:

- `src/versions/upto-26.1.1/` — NeoForge replaced `BlockEvent.BreakEvent` with
  `BreakBlockEvent` in Minecraft 26.1.2.
- `forge/src/versions/upto-1.21.5/` — Forge moved to EventBus 7 in Minecraft 1.21.6,
  where a cancellable listener returns `boolean` instead of calling `setCanceled`.

Fabric needs no overlay; its block-break API has not moved.

## Building

Requires JDK 21 (Minecraft 1.21.x) and JDK 25 (Minecraft 26.x); Gradle's toolchain
resolver downloads whichever is missing.

```bash
./gradlew build                     # NeoForge, against the default in gradle.properties
./gradlew -p forge build            # MinecraftForge
./gradlew -p fabric build           # Fabric

# A specific target
./gradlew build -Pneo_version=21.1.251
./gradlew -p forge build -Pforge_version=1.21.1-52.1.16
./gradlew -p fabric build -Pminecraft_version=1.21.1 -Pfabric_api_version=0.116.17+1.21.1 -Ploader_version=0.19.5

# Everything in versions.json, the way CI does it
node .github/scripts/build-all.mjs
node .github/scripts/build-all.mjs --loader fabric --only 1.21.1
```

## Releasing

```bash
node .github/scripts/release-plan.mjs
```

prints the jars a release would produce and which Minecraft versions each covers.
Targets share a jar when they compile from identical sources *and* sit on the same
side of the obfuscation boundary; the grouping is derived from the source tree, so
adding an overlay splits a group on its own.

Releases are cut from `main`:

- **Automatically** — `update-versions.yml` runs daily. If a new Minecraft version
  or a new loader appears, it is built first; only if that succeeds is
  `versions.json` committed, the patch version bumped, a tag pushed and the release
  dispatched. Loader build bumps that change nothing a player can see (a new
  NeoForge build, a new Fabric API) are committed without a release, so Modrinth
  does not collect empty versions.
- **By hand** — run the **Cut release** workflow from the Actions tab to release
  code changes, choosing patch/minor/major.

Day-to-day work happens on `dev` and reaches `main` through a pull request.

### Required repository configuration

| Where | Name | Value |
| --- | --- | --- |
| Secrets | `MODRINTH_TOKEN` | A Modrinth PAT with both *Read user data* and *Create versions* scopes. |
| Variables | `MODRINTH_ID` | The Modrinth project id for this mod. |

The release workflow checks both before building anything and fails with a pointed
message rather than halfway through publishing.

A brand-new Modrinth project is a **draft**: it is invisible to anyone but its
owner, so every API call about it has to carry the token. That is why the checks
here are authenticated, and it is normal for the first release to publish into a
draft — Modrinth wants a version to exist before you can submit the project for
review. The versions appear publicly once the project itself is approved.

## Licence

MIT. See [LICENSE](LICENSE).
