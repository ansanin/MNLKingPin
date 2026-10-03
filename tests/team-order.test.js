const assert = require('assert');
const { normalizeTeamOrderInput, buildTeamOrderLabel } = require('../js/team-order.js');

const teamInput = {
  isTeamOrder: true,
  teamName: 'Team Alpha',
  teamType: 'Basketball',
  totalPlayers: 12,
  teamNotes: 'Need matching jersey numbers.'
};

const normalized = normalizeTeamOrderInput(teamInput);
assert.strictEqual(normalized.isTeamOrder, true);
assert.strictEqual(normalized.teamName, 'Team Alpha');
assert.strictEqual(normalized.teamType, 'Basketball');
assert.strictEqual(normalized.totalPlayers, 12);
assert.strictEqual(buildTeamOrderLabel(normalized), 'Team Alpha • Basketball • 12 players');

const regularOrder = normalizeTeamOrderInput({ isTeamOrder: false });
assert.strictEqual(normalized.isTeamOrder, true);
assert.strictEqual(regularOrder.isTeamOrder, false);
assert.strictEqual(buildTeamOrderLabel(regularOrder), 'Individual order');

console.log('team-order tests passed');
