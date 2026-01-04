const CHEAP_RULE_METADATA = {
    'punctuation:em-dash': {
        title: 'Em Dash Spacing',
        reason: 'Chicago Style uses em dashes (—) without surrounding spaces.',
        cmos_ref: ['6.82', '6.85']
    },
    'spacing:colon': {
        title: 'Colon Spacing',
        reason: 'In Chicago Style, only one space should follow a colon.',
        cmos_ref: ['6.61']
    }
};

function applyCheapRules(text) {
    let revised = text;
    const changes = [];

    // 1. Colon Spacing
    const colonRegex = /:([^\s])/g;
    let match;
    while ((match = colonRegex.exec(revised)) !== null) {
        const charAfter = match[1];
        const rule_id = 'spacing:colon';
        const metadata = CHEAP_RULE_METADATA[rule_id];
        // Note: simplified replacement for mock
        revised = revised.replace(/:([^\s])/, ': $1');
        changes.push({
            id: `cheap-${Math.random().toString(36).substr(2, 9)}`,
            source: 'cheap_rule',
            rule_id,
            type: 'spacing',
            severity: 'required',
            title: metadata.title,
            reason: metadata.reason,
            cmos_ref: metadata.cmos_ref,
            before_text: ":",
            after_text: ": ",
            highlights: [{ scope: 'revised', start: match.index, end: match.index + 2, kind: 'replace' }]
        });
    }

    // 2. Em-dash
    const dashRegex = /\s?--\s?/g;
    while ((match = dashRegex.exec(revised)) !== null) {
        const rule_id = 'punctuation:em-dash';
        const metadata = CHEAP_RULE_METADATA[rule_id];
        revised = revised.replace(/\s?--\s?/, '—');
        changes.push({
            id: `cheap-${Math.random().toString(36).substr(2, 9)}`,
            source: 'cheap_rule',
            rule_id,
            type: 'punctuation',
            severity: 'required',
            title: metadata.title,
            reason: metadata.reason,
            cmos_ref: metadata.cmos_ref,
            before_text: "--",
            after_text: "—",
            highlights: [{ scope: 'revised', start: match.index, end: match.index + 1, kind: 'replace' }]
        });
    }

    return { revisedText: revised, changes };
}

function computeMissingChanges(original, revised, existingChanges = []) {
    const changes = [...existingChanges];
    if (original !== revised) {
        const isCovered = existingChanges.some(ec =>
            ec.highlights.some(h => (h.scope === 'revised' || h.scope === 'both'))
        );
        if (!isCovered) {
            changes.push({
                id: `post-${Math.random().toString(36).substr(2, 9)}`,
                source: 'postprocess',
                rule_id: 'auto_detected',
                type: 'other',
                severity: 'recommended',
                reason: "Auto-detected change",
                before_text: original,
                after_text: revised,
                highlights: [{
                    scope: 'revised',
                    start: 0,
                    end: revised.length,
                    kind: 'replace'
                }]
            });
        }
    }
    return changes;
}

function processAndFinalizeChanges(changes) {
    return changes.sort((a, b) => {
        const aStart = a.highlights[0]?.start ?? 0;
        const bStart = b.highlights[0]?.start ?? 0;
        return aStart - bStart;
    });
}

module.exports = {
    computeMissingChanges,
    applyCheapRules,
    processAndFinalizeChanges
};
