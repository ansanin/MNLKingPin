const assert = require('assert');
const { normalizeTeamOrderInput, buildTeamOrderLabel } = require('../js/team-order.js');

const teamInput = {
  isTeamOrder: true,
  teamName: 'Team Alpha',
  teamType: 'Basketball',
  totalPlayers: 12,
  teamSizes: '1: M, 2: L, 3: XL, 4: S',
  teamNotes: 'Need matching jersey numbers.'
};

const normalized = normalizeTeamOrderInput(teamInput);
assert.strictEqual(normalized.isTeamOrder, true);
assert.strictEqual(normalized.teamName, 'Team Alpha');
assert.strictEqual(normalized.teamType, 'Basketball');
assert.strictEqual(normalized.totalPlayers, 12);
assert.strictEqual(normalized.teamSizes, '1: M, 2: L, 3: XL, 4: S');
assert.strictEqual(buildTeamOrderLabel(normalized), 'Team Alpha • Basketball • 12 players • sizes: 1: M, 2: L, 3: XL, 4: S');

const regularOrder = normalizeTeamOrderInput({ isTeamOrder: false });
assert.strictEqual(normalized.isTeamOrder, true);
assert.strictEqual(regularOrder.isTeamOrder, false);
assert.strictEqual(buildTeamOrderLabel(regularOrder), 'Individual order');

console.log('team-order tests passed');
