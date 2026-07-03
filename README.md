# OSO Sense Tracker

A SillyTavern extension that tracks character state for roleplay set in the
world of *Only Sense Online* (OSO): equipped/owned Senses (max 10 equipped),
Sense Points, HP/MP, inventory, gold, a d20 dice-check system, and a simple
combat state machine.

This is an MVP skeleton — functional core logic, but you should test it
against your current SillyTavern version's extension API before relying on
it, since import paths and event names shift between releases.

## Install

1. Copy this folder into `public/scripts/extensions/third-party/oso-sense-tracker/`
   in your SillyTavern install (or use the in-app "Install extension" with
   your GitHub repo URL once you've pushed this).
2. Reload SillyTavern, enable the extension from the Extensions panel.
3. Paste the contents of `SYSTEM_PROMPT.md` into your system prompt or
   author's note for any character/scenario using OSO rules.

## File layout

```
manifest.json         entry point metadata SillyTavern reads on load
index.js               event wiring, parsing, rendering, prompt injection
style.css               panel styling
lib/state.js             schema + delta-merge logic (pure functions, no DOM)
lib/derived.js            client-computed values (SP progress, evolution, slots)
lib/dice.js                d20 roller + DC tier mapping (client-side only)
SYSTEM_PROMPT.md            instructions to paste into your ST system prompt
```

## Design principles (why it's built this way)

- **Delta-only updates.** The AI never re-states unchanged data. Every
  reported event is a small JSON line describing what changed. This keeps
  token cost flat regardless of how long a session runs — see
  `lib/state.js` → `applyDelta`.
- **Derived values are never trusted from the AI.** SP-from-level-milestones,
  free slot count, evolution readiness — all computed in `lib/derived.js`
  from raw state, so the AI can't miscalculate them.
- **Dice are rolled client-side only.** `lib/dice.js` uses
  `crypto.getRandomValues`, never asks the model to produce a number. The AI
  requests a roll and a difficulty *tier*; the numeric DC is locked from a
  fixed table before the roll happens and is never revised afterward.
- **Combat batches its expensive payload.** Per-turn, only HP/MP deltas are
  reported. Sense-level gains, loot, and SP are all bundled into a single
  `combat_end` event, so the one larger payload only fires once per fight
  instead of accumulating every turn.

## Known gaps / next steps

- `injectPanelHtml()` anchors the panel with a guessed selector
  (`#movingDivs, #chat`) — verify against your ST theme's DOM and adjust.
- No UI yet for browsing `ownedSenses` and equipping from the "+ empty"
  slots — currently equip/unequip only happens via AI-issued `sense_equip`/
  `sense_unequip` events. A click handler to open a picker is the natural
  next addition.
- Evolution rule in `lib/derived.js` is a placeholder (`level >= 50`) —
  replace with your actual per-sense evolution conditions.
- No per-swipe state isolation yet (RPG Companion does this — worth
  copying if you use swipes heavily).
- `SlashCommandParser` API shape may differ by ST version — check
  `public/scripts/slash-commands/` in your installed version.

## License

Use whatever license you'd like for your fork — this skeleton has no
license attached, add one before publishing.
