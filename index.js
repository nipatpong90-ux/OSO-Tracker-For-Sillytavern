// index.js
// OSO Sense Tracker — main entry point.
//
// NOTE: import paths below follow the common SillyTavern extension pattern
// (relative to public/scripts/extensions/third-party/<name>/). SillyTavern's
// internal module layout changes between versions — check
// public/scripts/extensions.js and public/script.js in the ST version you're
// targeting and adjust these imports if they've moved.

import { getContext, extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';

import { defaultState, applyDelta, MAX_EQUIPPED_SENSES } from './lib/state.js';
import { freeSlots, levelsToNextSP, isEvolutionReady, hpPercent, mpPercent, CATEGORY_COLORS } from './lib/derived.js';
import { performCheck, tierToDC } from './lib/dice.js';

const MODULE_NAME = 'oso-sense-tracker';

// ---------------------------------------------------------------------------
// Settings / state persistence
// ---------------------------------------------------------------------------
// Global toggles (theme, enabled/disabled) live in extension_settings — same
// across every chat. Per-character game state (HP, senses, inventory) is
// stored via chat metadata so different characters/chats don't share state.

function initSettings() {
  if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = { enabled: true, theme: 'fantasy' };
    saveSettingsDebounced();
  }
  return extension_settings[MODULE_NAME];
}

function getGameState() {
  const context = getContext();
  const meta = context.chatMetadata || {};
  if (!meta.osoState) {
    meta.osoState = defaultState();
    context.saveMetadata();
  }
  return meta.osoState;
}

function persistGameState() {
  const context = getContext();
  context.saveMetadata();
}

// ---------------------------------------------------------------------------
// Parsing AI output
// ---------------------------------------------------------------------------
// The AI is instructed (see SYSTEM_PROMPT.md) to wrap delta events in a
// fenced block like:
//   <oso_state>{"type":"sense_level_up","sense":"ดาบ","newLevel":43}</oso_state>
// Multiple events in one message are newline-separated inside the block.
// This block is stripped from what the user actually sees.

const STATE_BLOCK_RE = /<oso_state>([\s\S]*?)<\/oso_state>/g;

function extractDeltas(messageText) {
  const deltas = [];
  let match;
  while ((match = STATE_BLOCK_RE.exec(messageText)) !== null) {
    match[1].trim().split('\n').forEach(line => {
      line = line.trim();
      if (!line) return;
      try {
        deltas.push(JSON.parse(line));
      } catch (e) {
        console.warn(`[${MODULE_NAME}] failed to parse state line:`, line, e);
      }
    });
  }
  return deltas;
}

function stripStateBlocks(messageText) {
  return messageText.replace(STATE_BLOCK_RE, '').trim();
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onMessageReceived(messageId) {
  const context = getContext();
  const message = context.chat[messageId];
  if (!message || message.is_user) return;

  const deltas = extractDeltas(message.mes);
  if (deltas.length === 0) return;

  const state = getGameState();
  deltas.forEach(delta => applyDelta(state, delta));
  persistGameState();

  message.mes = stripStateBlocks(message.mes);
  renderPanel();
}

// Injects the current, derived-value-enriched game rules + a short state
// summary before every generation. Kept intentionally short — this is the
// one payload that recurs every single turn, so it's the main fixed cost.
function onGenerationStarted(type, params, dryRun) {
  if (dryRun) return;
  const state = getGameState();
  const context = getContext();

  const equippedSummary = state.equippedSenses
    .map(s => `${s.name} Lv${s.level}`)
    .join(', ') || 'none';

  const injection = [
    `[OSO state — HP ${state.character.hp}/${state.character.hpMax}, `,
    `MP ${state.character.mp}/${state.character.mpMax}, SP ${state.sensePoints}, `,
    `equipped senses: ${equippedSummary}, free slots: ${freeSlots(state)}, `,
    `combat: ${state.combat.state}]`,
  ].join('');

  // setExtensionPrompt keeps this out of the visible chat log while still
  // reaching the model. Position/depth may need tuning per ST version.
  context.setExtensionPrompt(MODULE_NAME, injection, 1, 0);
}

// ---------------------------------------------------------------------------
// Dice roll request flow
// ---------------------------------------------------------------------------
// Called when the AI's output contains a roll request block, e.g.:
//   <oso_roll sense="ดาบ" tier="hard" action="attack" />
// The result is rolled here, shown in the panel, then injected as a locked
// fact via setExtensionPrompt before the next generation continues.

function handleRollRequest({ sense, tier, action }) {
  const state = getGameState();
  const senseObj = state.ownedSenses.find(s => s.name === sense);
  const result = performCheck({ senseLevel: senseObj?.level || 0, tier });

  state.diceLog.unshift({ ...result, sense, action });
  state.diceLog = state.diceLog.slice(0, 10);
  persistGameState();

  const context = getContext();
  const factLine = `[SYSTEM: ${action} check — 1d20(${result.roll}) + ${result.modifier} (${sense}) `
    + `= ${result.total} vs DC ${result.dc} (${tier}) → `
    + `${result.criticalSuccess ? 'CRITICAL SUCCESS' : result.criticalFailure ? 'CRITICAL FAILURE' : result.success ? 'Success' : 'Failure'}. `
    + `This result is final and must not be re-rolled or contradicted.]`;

  context.setExtensionPrompt(`${MODULE_NAME}-roll`, factLine, 1, 0);
  renderDiceWidget(result, sense, action);
  return result;
}

// ---------------------------------------------------------------------------
// Slash command: manual rolls, e.g. /oso-roll sense="ดาบ" tier=hard
// ---------------------------------------------------------------------------

function registerSlashCommands() {
  const context = getContext();
  if (!context.SlashCommandParser) return; // older ST versions may differ

  context.SlashCommandParser.addCommandObject(
    context.SlashCommand.fromProps({
      name: 'oso-roll',
      callback: (args) => {
        const result = handleRollRequest({
          sense: args.sense || 'unknown',
          tier: args.tier || 'medium',
          action: args.action || 'manual check',
        });
        return `Rolled ${result.roll} + ${result.modifier} = ${result.total} vs DC ${result.dc}`;
      },
      namedArgumentList: [],
      helpString: 'Manually roll a d20 check against a named sense and difficulty tier.',
    }),
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderPanel() {
  const state = getGameState();
  const $panel = $('#oso-panel');
  if ($panel.length === 0) return;

  const sensesHtml = state.equippedSenses.map(s => `
    <div class="oso-sense-chip" style="border-left: 3px solid ${CATEGORY_COLORS[s.category] || '#888'}">
      <span class="oso-sense-name">${escapeHtml(s.name)}</span>
      <span class="oso-sense-level">Lv ${s.level}</span>
      ${isEvolutionReady(s) ? '<span class="oso-evolve-badge">Evolve ready</span>' : ''}
    </div>
  `).join('') + Array.from({ length: freeSlots(state) }).map(() =>
    '<div class="oso-sense-chip oso-sense-empty">+ empty</div>'
  ).join('');

  const inventoryHtml = state.inventory.map(i => `
    <div class="oso-item-row">
      <span>${escapeHtml(i.name)}</span>
      <span class="oso-item-qty">${i.qty}</span>
    </div>
  `).join('') || '<div class="oso-item-row oso-empty">Empty</div>';

  $panel.html(`
    <div class="oso-vitals">
      <div class="oso-bar-row"><span>HP</span><div class="oso-bar"><div class="oso-bar-fill oso-hp" style="width:${hpPercent(state.character)}%"></div></div><span>${state.character.hp}/${state.character.hpMax}</span></div>
      <div class="oso-bar-row"><span>MP</span><div class="oso-bar"><div class="oso-bar-fill oso-mp" style="width:${mpPercent(state.character)}%"></div></div><span>${state.character.mp}/${state.character.mpMax}</span></div>
    </div>
    <div class="oso-sp">SP available: ${state.sensePoints}</div>
    <div class="oso-senses"><h4>Equipped senses (${state.equippedSenses.length}/${MAX_EQUIPPED_SENSES})</h4>${sensesHtml}</div>
    <div class="oso-inventory"><h4>Inventory</h4>${inventoryHtml}</div>
    <div class="oso-gold">Gold: ${state.gold}</div>
  `);
}

function renderDiceWidget(result, sense, action) {
  const $log = $('#oso-dice-log');
  if ($log.length === 0) return;
  const cls = result.criticalSuccess ? 'oso-crit-success' : result.criticalFailure ? 'oso-crit-fail' : result.success ? 'oso-success' : 'oso-fail';
  $log.prepend(`
    <div class="oso-roll-entry ${cls}">
      <strong>${escapeHtml(action)}</strong> (${escapeHtml(sense)}):
      d20(${result.roll}) + ${result.modifier} = ${result.total} vs DC ${result.dc}
    </div>
  `);
}

function escapeHtml(str) {
  return $('<div>').text(str).html();
}

function injectPanelHtml() {
  if ($('#oso-panel-container').length) return;
  const container = `
    <div id="oso-panel-container">
      <div id="oso-panel"></div>
      <div id="oso-dice-log"></div>
    </div>
  `;
  $('#movingDivs, #chat').first().before(container); // adjust anchor to taste
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

jQuery(async () => {
  initSettings();
  injectPanelHtml();
  registerSlashCommands();

  eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
  eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);

  renderPanel();
  console.log(`[${MODULE_NAME}] loaded`);
});

// Exported for manual/test use from the browser console.
window.OSOSenseTracker = { handleRollRequest, getGameState, renderPanel };
