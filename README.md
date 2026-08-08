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
- **Phase 1 - One entity + effects/status** - next up. Unify player/monster
  entities, add a declarative effect-descriptor resolver, add status
  effects, add a real stat pipeline.
- **Phase 2 - Progression** - XP, level curves, active combat abilities.
- **Phase 3 - Storylets** - replace the `resolveEvent` switch with data-driven
  storylets over a "quality" map.
- **Phase 4 - Companions become real entities.**
- **Phase 5 - Inventory & loot-box UI.**
- **Phase 6 - Quests.**
- **Phase 7 - Prose + platform** - LLM narration upgrade, then move to a
  server-rendered platform to hide the API key.

Ship each phase as small, testable commits; never big-bang.
