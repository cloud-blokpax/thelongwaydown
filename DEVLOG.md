# Devlog

## Phase 1 - status/effects (shipped)
Enemy is now a first-class entity (`S.enemy`); data-driven statuses
(bleeding/burning/stunned/weakened/guarded) via an effect-descriptor
resolver (`WORLD.statuses`, `startTurn`, `addStatus`, `rollStatusEffects`);
status mods folded into the stat pipeline (`statMod`, `effStat`); save v2
(persists enemy + statuses + cooldowns mid-fight, with v1 migration on load).

## Phase 2 - progression (shipped)
Kill-based XP (`gainXp`) with a data-driven level curve
(`WORLD.config.xp` base 24, growth 1.4); per-class abilities
(`WORLD.abilities`) + universal Guard as effect descriptors resolved by
`resolveAbility`; cooldowns (`S.cooldowns`, reset per fight, persisted in
save, ticked at the start of each player action); level/ability HUD.

## Phase 3 - storylets (shipped)
WORLD.storylets + applyStoryEffects replace the resolveEvent switch and
WORLD.events. S.qualities map (saved, v3). Storylet/choice prereqs gate on
floor + qualities. Lazy deterministic selection via positional hash. 11 events
ported 1:1; dead switch/array removed.

## Phase 4 - companions as entities (shipped)
WORLD.companions gain stat blocks; S.companion is a live entity via
buildCompanion(). Companion takes a combat turn (dmg + on-hit statuses);
enemy may target it; downed at 0; revive on descend/rest. trust_<id> saved
quality (rest +1; >=3 -> +2 dmg). Ally UI card. Save v4 (+migration).

## Phase 5 - inventory + loot boxes (shipped)
Bag screen (view/equip/sell), sealed tiered boxes (makeBox/openBox) for
achievement+boss rewards, one-place inventory model (equipment XOR bag).

## Phase 6 - quests (shipped)
prereq qualMax + pinned storylets; 'The Beacon' 3-step chain over quest_beacon
with a Mythic payoff. Quests are data on the Phase 3 storylet engine.

## Content-depth expansion (shipped)
Race->archetype->class dependency (class gated by race). +5 races, +7 classes/
abilities, rallied status, +14 gear, +3 companions, +6 mobs, +2 hunter bosses.
14 branching storylets + spawn effect (choices lead into combat/loot/safe).
Bigger floors, more events. Optional bosses (face now / mark for later); marked
bosses ambush on later floors. Save v5 (markedBosses, floorDirty, dirty-floor
encs snapshot) + migration.
