// lib/state.js
// Defines the data shape for OSO Sense Tracker and the delta-merge logic.
// IMPORTANT: the AI never sends a full state dump. It only ever sends small
// "delta" events. Everything else (SP progress, evolution readiness, free
// slot count) is derived client-side in derived.js.

export const MAX_EQUIPPED_SENSES = 10;

// A single Sense as tracked in state.
// { id, name, category, level, evolved }
// category is one of: "combat" | "magic" | "craft" | "support"

export function defaultState() {
  return {
    schemaVersion: 1,
    character: {
      name: '',
      hp: 100,
      hpMax: 100,
      mp: 50,
      mpMax: 50,
    },
    sensePoints: 10, // starting SP per OSO rules
    equippedSenses: [],   // active, max MAX_EQUIPPED_SENSES
    ownedSenses: [],       // full collection, unlimited
    inventory: [],          // { id, name, qty, tag }
    gold: 0,
    combat: {
      state: 'idle',        // 'idle' | 'in_combat' | 'resolving'
      turnsInCombat: 0,
      log: [],               // last N combat_end summaries
    },
    diceLog: [],              // last N dice rolls, for the history widget
  };
}

// Merge a delta event (parsed from the AI's output) into the current state.
// Every event has a `type` field. Unknown types are ignored (fail open, not
// closed, so a malformed AI response never crashes the panel).
export function applyDelta(state, delta) {
  if (!delta || typeof delta !== 'object' || !delta.type) return state;

  switch (delta.type) {
    case 'vitals_update': {
      if (typeof delta.hp === 'number') state.character.hp = clamp(delta.hp, 0, state.character.hpMax);
      if (typeof delta.mp === 'number') state.character.mp = clamp(delta.mp, 0, state.character.mpMax);
      break;
    }

    case 'sense_level_up': {
      const sense = findOrCreateSense(state, delta.sense, delta.category);
      const before = sense.level;
      sense.level = delta.newLevel ?? sense.level;
      // SP is earned automatically every 10 levels of an EQUIPPED sense.
      // Client computes this — never trust an sp_earned field from the AI.
      const milestonesCrossed = Math.floor(sense.level / 10) - Math.floor(before / 10);
      const isEquipped = state.equippedSenses.some(s => s.id === sense.id);
      if (isEquipped && milestonesCrossed > 0) {
        state.sensePoints += milestonesCrossed;
      }
      break;
    }

    case 'sense_equip': {
      const sense = state.ownedSenses.find(s => s.id === delta.senseId);
      if (sense && state.equippedSenses.length < MAX_EQUIPPED_SENSES &&
          !state.equippedSenses.some(s => s.id === sense.id)) {
        state.equippedSenses.push(sense);
      }
      break;
    }

    case 'sense_unequip': {
      state.equippedSenses = state.equippedSenses.filter(s => s.id !== delta.senseId);
      break;
    }

    case 'sense_acquired': {
      // New sense purchased with SP. Client enforces the SP cost check —
      // the AI only declares intent, it does not move points itself.
      const cost = delta.cost ?? 1;
      if (state.sensePoints >= cost) {
        state.sensePoints -= cost;
        const sense = {
          id: delta.id || cryptoId(),
          name: delta.sense,
          category: delta.category || 'support',
          level: 1,
          evolved: false,
        };
        state.ownedSenses.push(sense);
      }
      break;
    }

    case 'inventory_add': {
      const existing = state.inventory.find(i => i.name === delta.item);
      if (existing) existing.qty += delta.qty ?? 1;
      else state.inventory.push({ id: cryptoId(), name: delta.item, qty: delta.qty ?? 1, tag: delta.tag || '' });
      break;
    }

    case 'inventory_remove': {
      const existing = state.inventory.find(i => i.name === delta.item);
      if (existing) {
        existing.qty -= delta.qty ?? 1;
        if (existing.qty <= 0) state.inventory = state.inventory.filter(i => i.id !== existing.id);
      }
      break;
    }

    case 'gold_change': {
      state.gold = Math.max(0, state.gold + (delta.amount || 0));
      break;
    }

    case 'combat_start': {
      state.combat.state = 'in_combat';
      state.combat.turnsInCombat = 0;
      break;
    }

    case 'combat_end': {
      // The one place we accept a larger payload — see COMBAT.md.
      // outcome: "victory" | "defeat" | "fled"
      state.combat.state = 'resolving';
      const summary = {
        outcome: delta.outcome,
        senseGains: [],
        loot: delta.loot || [],
        goldGained: delta.gold_gained || 0,
        spEarned: 0,
        timestamp: Date.now(),
      };

      (delta.sense_gains || []).forEach(g => {
        const sense = findOrCreateSense(state, g.sense, g.category);
        const before = sense.level;
        sense.level = g.levelAfter ?? sense.level;
        const isEquipped = state.equippedSenses.some(s => s.id === sense.id);
        const milestonesCrossed = Math.floor(sense.level / 10) - Math.floor(before / 10);
        if (isEquipped && milestonesCrossed > 0) {
          state.sensePoints += milestonesCrossed;
          summary.spEarned += milestonesCrossed;
        }
        summary.senseGains.push({ sense: sense.name, before, after: sense.level });
      });

      if (delta.outcome === 'defeat') {
        // Simple defeat penalty: lose 10% carried gold. Extend as needed.
        const lost = Math.floor(state.gold * 0.1);
        state.gold -= lost;
        summary.goldLost = lost;
      } else {
        state.gold += summary.goldGained;
      }
      (delta.loot || []).forEach(item => {
        const existing = state.inventory.find(i => i.name === item.name);
        if (existing) existing.qty += item.qty ?? 1;
        else state.inventory.push({ id: cryptoId(), name: item.name, qty: item.qty ?? 1, tag: 'loot' });
      });

      state.combat.log.unshift(summary);
      state.combat.log = state.combat.log.slice(0, 10);
      state.combat.state = 'idle';
      break;
    }

    default:
      // Unknown event type — ignore silently, never throw.
      break;
  }

  return state;
}

function findOrCreateSense(state, name, category) {
  let sense = state.ownedSenses.find(s => s.name === name);
  if (!sense) {
    sense = { id: cryptoId(), name, category: category || 'support', level: 0, evolved: false };
    state.ownedSenses.push(sense);
  }
  return sense;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function cryptoId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
