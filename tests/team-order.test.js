const assert = require('assert');
const { MIN_TEAM_PLAYERS, isValidTeamPlayerCount, areTeamPlayerDetailsComplete, normalizeTeamOrderInput, buildTeamOrderLabel, buildTeamSizeSummary } = require('../js/team-order.js');

assert.strictEqual(MIN_TEAM_PLAYERS, 5);
assert.strictEqual(isValidTeamPlayerCount(4), false);
assert.strictEqual(isValidTeamPlayerCount(5), true);
assert.strictEqual(isValidTeamPlayerCount(5.5), false);

const completeTeamSizes = [
  { player: 1, surname: 'Dela Cruz', jerseyNumber: '10', topSize: 'M', bottomSize: 'S' },
  { player: 2, surname: 'Santos', jerseyNumber: '7', topSize: 'L', bottomSize: 'M' },
  { player: 3, surname: 'Reyes', jerseyNumber: '0', topSize: 'XL', bottomSize: 'L' },
  { player: 4, surname: 'Garcia', jerseyNumber: '4', topSize: 'S', bottomSize: 'XS' },
  { player: 5, surname: 'Cruz', jerseyNumber: '5', topSize: 'M', bottomSize: 'S' }
];
assert.strictEqual(areTeamPlayerDetailsComplete(completeTeamSizes, 5), true);
assert.strictEqual(areTeamPlayerDetailsComplete(completeTeamSizes.slice(0, 4), 5), false);
assert.strictEqual(areTeamPlayerDetailsComplete([{ ...completeTeamSizes[0], jerseyNumber: '100' }, ...completeTeamSizes.slice(1)], 5), false);
assert.strictEqual(areTeamPlayerDetailsComplete(Array.from({ length: 10 }, (_, index) => ({
  player: index + 1,
  surname: `Player ${index + 1}`,
  jerseyNumber: String(index),
  topSize: 'M',
  bottomSize: 'S'
})), 10), true);

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
  { player: 1, surname: '', jerseyNumber: '', topSize: 'M', bottomSize: 'S' },
  { player: 2, surname: '', jerseyNumber: '', topSize: 'L', bottomSize: 'M' },
  { player: 3, surname: '', jerseyNumber: '', topSize: 'XL', bottomSize: 'L' },
  { player: 4, surname: '', jerseyNumber: '', topSize: 'S', bottomSize: 'XS' }
]);
assert.strictEqual(buildTeamOrderLabel(normalized), 'Team Alpha • Basketball • 4 players • sizes: 1:UM/LS, 2:UL/LM, 3:UXL/LL, 4:US/LXS');
assert.strictEqual(buildTeamSizeSummary(normalized.teamSizes), 'Player 1: Upper M / Lower S • Player 2: Upper L / Lower M • Player 3: Upper XL / Lower L • Player 4: Upper S / Lower XS');
assert.strictEqual(buildTeamSizeSummary(completeTeamSizes).includes('Player 1: Dela Cruz (#10): Upper M / Lower S'), true);

assert.deepStrictEqual(normalizeTeamOrderInput({ teamSizes: [{ player: 1, size: 'M' }] }).teamSizes, [
  { player: 1, surname: '', jerseyNumber: '', topSize: 'M', bottomSize: '' }
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
