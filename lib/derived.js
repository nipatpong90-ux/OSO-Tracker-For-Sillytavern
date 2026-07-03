// lib/derived.js
// Everything here is calculated from state.js data. None of these values are
// ever requested from or trusted from the AI — this is what keeps token cost
// flat regardless of how deep a character's sense collection grows.

import { MAX_EQUIPPED_SENSES } from './state.js';

export function freeSlots(state) {
  return MAX_EQUIPPED_SENSES - state.equippedSenses.length;
}

// Levels remaining until the sense's next automatic SP milestone (every 10 lvl).
export function levelsToNextSP(sense) {
  return 10 - (sense.level % 10 === 0 ? 10 : sense.level % 10);
}

// Simple evolution rule: level >= 50 and not already evolved.
// Replace with your own per-sense evolution conditions as your rules grow.
export function isEvolutionReady(sense) {
  return !sense.evolved && sense.level >= 50;
}

export function hpPercent(character) {
  return Math.round((character.hp / character.hpMax) * 100);
}

export function mpPercent(character) {
  return Math.round((character.mp / character.mpMax) * 100);
}

// Groups owned senses by category for the "owned" tab / color coding.
export function groupByCategory(senses) {
  return senses.reduce((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});
}

export const CATEGORY_COLORS = {
  combat: '#D85A30',
  magic: '#378ADD',
  craft: '#E0A030',
  support: '#639922',
};
