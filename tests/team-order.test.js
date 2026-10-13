const assert = require('assert');
const { normalizeTeamOrderInput, buildTeamOrderLabel, buildTeamSizeSummary } = require('../js/team-order.js');

const teamInput = {
  isTeamOrder: true,
  teamName: 'Team Alpha',
  teamType: 'Basketball',
  totalPlayers: 4,
  teamSizes: [
    { player: 1, topSize: 'M', bottomSize: 'S' },
    { player: 2, topSize: 'L', bottomSize: 'M' },
    { player: 3, topSize: 'XL', bottomSize: 'L' },
    { player: 4, topSize: 'S', bottomSize: 'XS' }
  ],
  teamNotes: 'Need matching jersey numbers.'
};

const normalized = normalizeTeamOrderInput(teamInput);
assert.strictEqual(normalized.isTeamOrder, true);
assert.strictEqual(normalized.teamName, 'Team Alpha');
assert.strictEqual(normalized.teamType, 'Basketball');
assert.strictEqual(normalized.totalPlayers, 4);
assert.deepStrictEqual(normalized.teamSizes, [
  { player: 1, topSize: 'M', bottomSize: 'S' },
  { player: 2, topSize: 'L', bottomSize: 'M' },
  { player: 3, topSize: 'XL', bottomSize: 'L' },
  { player: 4, topSize: 'S', bottomSize: 'XS' }
]);
assert.strictEqual(buildTeamOrderLabel(normalized), 'Team Alpha • Basketball • 4 players • sizes: 1:UM/BS, 2:UL/BM, 3:UXL/BL, 4:US/BXS');
assert.strictEqual(buildTeamSizeSummary(normalized.teamSizes), 'Player 1: Upper M / Bottom S • Player 2: Upper L / Bottom M • Player 3: Upper XL / Bottom L • Player 4: Upper S / Bottom XS');

assert.deepStrictEqual(normalizeTeamOrderInput({ teamSizes: [{ player: 1, size: 'M' }] }).teamSizes, [
  { player: 1, topSize: 'M', bottomSize: '' }
]);

const regularOrder = normalizeTeamOrderInput({
  isTeamOrder: false,
  totalPlayers: 2,
  teamSizes: [{ player: 1, size: 'M' }]
});
assert.strictEqual(normalized.isTeamOrder, true);
assert.strictEqual(regularOrder.isTeamOrder, false);
assert.strictEqual(buildTeamOrderLabel(regularOrder), 'Individual order');

console.log('team-order tests passed');
