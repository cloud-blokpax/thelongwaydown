# The Long Way Down

A single-file, mobile-first, procedural LitRPG dungeon-crawler. Descend eight
floors of a lethal dungeon that's secretly an alien game show, racing a
per-floor collapse timer through combat, events, loot, and safe rooms. Original
IP inspired by the *Dungeon Crawler Carl* genre, but all names, mobs, items,
and copy are original. Non-commercial, fan-adjacent original work.

## Layout

The game is a single static file, `index.html`, at the repo root. Vanilla
JS (ES5 style: `var`, function declarations, no build step), pure ASCII
(non-ASCII characters are written as `\uXXXX` escapes inside JS strings).
No external requests, no assets, no bundler.

Vercel project `the-long-way-down` has its Root Directory set to the repo
root and is connected via Git integration: pushes to `main` auto-deploy to
production, pushes to other branches / open PRs get preview URLs.

## Verifying a build

```bash
# ASCII check
LC_ALL=C grep -qP '[^\x00-\x7F]' index.html && echo HAS_NONASCII || echo OK

# JS syntax check (extract the <script> body first)
node --check check.js && echo "JS OK"
```

See the architecture guide (design bible, tracked separately) for the full
engine breakdown: seeded RNG (`makeRng` for floor gen, `draw()`/`hashF` for
gameplay), the event bus, versioned save system (`SAVE_KEY`), and the
command dispatch path (`dispatch`/`ACTIONS`).

## Roadmap

- **Phase 0 - Foundations** - done. Deterministic seeded RNG, versioned
  save/resume, event bus, command dispatch, centralized mutation helpers.
- **Phase 1 - One entity + effects/status** - done. First-class enemy
  entity, a declarative effect-descriptor resolver, status effects
  (bleeding/burning/stunned/weakened/guarded), save format v2.
- **Phase 2 - Progression** - done. Kill-based XP, a data-driven level
  curve, active per-class combat abilities + universal Guard, cooldowns.
- **Phase 3 - Storylets** - done. Replaced the `resolveEvent` switch and
  `WORLD.events` with data-driven storylets over a "quality" map
  (`WORLD.storylets`, `applyStoryEffects`, `S.qualities`), save format v3.
- **Phase 4 - Companions become real entities** - done. Companions gain
  stat blocks (`WORLD.companions`) and become live entities (`S.companion`)
  via `buildCompanion`, sharing the player/enemy entity pipeline: a combat
  turn, enemy targeting, downed state, revive on descend/rest, `trust_<id>`
  as a saved quality, save format v4.
- **Phase 5 - Inventory/loot boxes** - done. A Bag screen (`renderBag`) for
  viewing equipped slots, sealed tiered loot boxes, and spare gear; manual
  equip/sell (`equipItem`/`sellItem`); sealed boxes (`makeBox`/`openBox`)
  for achievement + boss rewards; a one-place inventory model where an item
  lives in `equipment` XOR `bag`, never both.
- **Phase 6 - Quests** - done. Prereq gains `qualMax` for exact-stage
  gating and a `pin` flag for selection priority; "The Beacon" is the first
  quest, a 3-step storylet chain (`beacon-start` -> `beacon-1` ->
  `beacon-2`) over the `quest_beacon` quality with a forced-equip Mythic
  payoff.
- **Content-depth expansion** - done. Race sets an `archetype` that gates
  class (class is now a specialization of the race); 14 new branching
  storylets plus a `spawn` effect so choices can lead into combat/loot/safe;
  much bigger floors with more exploration events; optional bosses with a
  face-now / mark-for-later gate, where marked bosses can ambush as a
  forced `hunter` fight on a later floor. +5 races, +7 classes/abilities,
  a `rallied` status, +14 gear, +3 companions, +6 mobs, +2 hunter bosses.
  Save format v5 (`markedBosses`, `floorDirty`, dirty-floor `encs`
  snapshot) with migration from v1-v4.
- **Phase 7 - LLM narration + platform** - next up. LLM upgrade over the
  `templateFor`/`NARR` prose layer, strictly downstream of state, template
  as offline/fallback; migrate to a server-rendered platform to hide the
  API key.

Ship each phase as small, testable commits; never big-bang.
