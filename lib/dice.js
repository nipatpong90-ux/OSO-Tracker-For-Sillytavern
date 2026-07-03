// lib/dice.js
// The AI never rolls dice and never invents a DC number. It only ever:
//   1. requests a roll (names the sense involved)
//   2. picks a difficulty TIER from a fixed vocabulary
// Everything numeric happens here, client-side, with crypto randomness.

export const DIFFICULTY_TIERS = {
  trivial: 5,
  easy: 10,
  medium: 15,
  hard: 20,
  extreme: 25,
};

export function tierToDC(tier) {
  return DIFFICULTY_TIERS[tier] ?? DIFFICULTY_TIERS.medium;
}

export function rollDie(sides = 20) {
  // crypto.getRandomValues avoids the modulo-bias and predictability issues
  // of Math.random() for anything that matters to fairness.
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % sides) + 1;
}

// modifier = floor(senseLevel / 5) — must match the constant told to the AI
// in the system prompt (see SYSTEM_PROMPT.md). If you change this formula,
// update the prompt too, or AI narration and real numbers will drift apart.
export function senseModifier(senseLevel) {
  return Math.floor((senseLevel || 0) / 5);
}

// Performs a full check: rolls, applies modifier, compares to DC, flags crits.
// `tier` is chosen by the AI (see requestRoll flow in index.js); DC is locked
// here, before the roll happens, and is never changed retroactively.
export function performCheck({ senseLevel, tier }) {
  const dc = tierToDC(tier);
  const roll = rollDie(20);
  const modifier = senseModifier(senseLevel);
  const total = roll + modifier;

  return {
    roll,
    modifier,
    total,
    dc,
    tier,
    success: total >= dc,
    criticalSuccess: roll === 20,
    criticalFailure: roll === 1,
    timestamp: Date.now(),
  };
}
