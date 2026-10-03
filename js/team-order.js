(function (global) {
    function normalizeTeamOrderInput(input) {
        const source = input && typeof input === 'object' ? input : {};
        const isTeamOrder = Boolean(
            source.isTeamOrder === true ||
            source.teamOrder === true ||
            source.teamName ||
            source.teamType ||
            source.teamNotes ||
            (Number(source.totalPlayers) > 0)
        );

        const teamName = String(source.teamName || '').trim();
        const teamType = String(source.teamType || '').trim();
        const totalPlayers = Number(source.totalPlayers);
        const teamNotes = String(source.teamNotes || '').trim();

        return {
            isTeamOrder,
            teamName,
            teamType,
            totalPlayers: Number.isFinite(totalPlayers) && totalPlayers > 0 ? totalPlayers : 0,
            teamNotes
        };
    }

    function buildTeamOrderLabel(input) {
        const normalized = normalizeTeamOrderInput(input);

        if (!normalized.isTeamOrder) {
            return 'Individual order';
        }

        const teamName = normalized.teamName || 'Team order';
        const teamType = normalized.teamType ? ` • ${normalized.teamType}` : '';
        const playerCount = normalized.totalPlayers > 0 ? ` • ${normalized.totalPlayers} players` : '';

        return `${teamName}${teamType}${playerCount}`;
    }

    const api = {
        normalizeTeamOrderInput,
        buildTeamOrderLabel
    };

    global.normalizeTeamOrderInput = api.normalizeTeamOrderInput;
    global.buildTeamOrderLabel = api.buildTeamOrderLabel;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
