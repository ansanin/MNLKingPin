(function (global) {
    function parseTeamSizes(value) {
        if (Array.isArray(value)) {
            return value
                .map(item => ({
                    player: Number(item && item.player),
                    size: String(item && item.size || '').trim()
                }))
                .filter(item => Number.isFinite(item.player) && item.player > 0 && item.size);
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return [];

            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return parseTeamSizes(parsed);
            } catch (error) {
                // Ignore malformed JSON and fall back to the text format below.
            }

            const matches = [...trimmed.matchAll(/(\d+)\s*:\s*([^,\n]+)/g)];
            if (matches.length) {
                return matches
                    .map(match => ({
                        player: Number(match[1]),
                        size: String(match[2]).trim()
                    }))
                    .filter(item => Number.isFinite(item.player) && item.player > 0 && item.size);
            }

            return [];
        }

        return [];
    }

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
        const teamSizes = parseTeamSizes(source.teamSizes);

        return {
            isTeamOrder,
            teamName,
            teamType,
            totalPlayers: Number.isFinite(totalPlayers) && totalPlayers > 0 ? totalPlayers : 0,
            teamNotes,
            teamSizes
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
        const sizeSummary = normalized.teamSizes.length
            ? ` • sizes: ${normalized.teamSizes.map(item => `${item.player}:${item.size}`).join(', ')}`
            : '';

        return `${teamName}${teamType}${playerCount}${sizeSummary}`;
    }

    const api = {
        normalizeTeamOrderInput,
        buildTeamOrderLabel,
        parseTeamSizes
    };

    global.normalizeTeamOrderInput = api.normalizeTeamOrderInput;
    global.buildTeamOrderLabel = api.buildTeamOrderLabel;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
