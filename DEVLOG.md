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
