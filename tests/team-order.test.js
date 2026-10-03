const assert = require('assert');
const { normalizeTeamOrderInput, buildTeamOrderLabel } = require('../js/team-order.js');

const teamInput = {
  isTeamOrder: true,
  teamName: 'Team Alpha',
  teamType: 'Basketball',
  totalPlayers: 4,
  teamSizes: [
    { player: 1, size: 'M' },
    { player: 2, size: 'L' },
    { player: 3, size: 'XL' },
    { player: 4, size: 'S' }
  ],
  teamNotes: 'Need matching jersey numbers.'
};

const normalized = normalizeTeamOrderInput(teamInput);
assert.strictEqual(normalized.isTeamOrder, true);
assert.strictEqual(normalized.teamName, 'Team Alpha');
assert.strictEqual(normalized.teamType, 'Basketball');
assert.strictEqual(normalized.totalPlayers, 4);
assert.deepStrictEqual(normalized.teamSizes, [
  { player: 1, size: 'M' },
  { player: 2, size: 'L' },
  { player: 3, size: 'XL' },
  { player: 4, size: 'S' }
]);
assert.strictEqual(buildTeamOrderLabel(normalized), 'Team Alpha • Basketball • 4 players • sizes: 1:M, 2:L, 3:XL, 4:S');

const regularOrder = normalizeTeamOrderInput({ isTeamOrder: false });
assert.strictEqual(normalized.isTeamOrder, true);
assert.strictEqual(regularOrder.isTeamOrder, false);
assert.strictEqual(buildTeamOrderLabel(regularOrder), 'Individual order');

console.log('team-order tests passed');
