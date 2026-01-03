// test_cheap_rules.js
// Simplified local test to verify regex logic for Cheap Rules

function applyCheapRules(text) {
    let revised = text
    const changes = []
    let ruleChangeCounter = 1

    function applyRegexRule(regex, replacementFn, type, reason) {
        let match
        regex.lastIndex = 0
        const matches = []

        while ((match = regex.exec(revised)) !== null) {
            const before = match[0]
            const after = replacementFn(match)
            if (before !== after) {
                matches.push({
                    index: match.index,
                    length: before.length,
                    before,
                    after
                })
            }
        }

        // Sort reverse
        matches.sort((a, b) => b.index - a.index)

        for (const m of matches) {
            const delta = m.after.length - m.before.length
            revised = revised.substring(0, m.index) + m.after + revised.substring(m.index + m.length)

            if (delta !== 0) {
                for (const change of changes) {
                    if (change.loc && change.loc.start > m.index) {
                        change.loc.start += delta
                        change.loc.end += delta
                        // Also update stored 'loc' object if structure differs in test vs app
                    }
                    // For this simple test script, we didn't use 'loc' property initially, 
                    // but the test logic below iterates changes. 
                    // We should add 'loc' to the test script if we want to debug locations.
                }
            }

            changes.push({
                id: `c${ruleChangeCounter++}`,
                before: m.before,
                after: m.after,
                reason,
                loc: { start: m.index, end: m.index + m.after.length }
            })
        }
    }

    // A. Em-dash "--"
    applyRegexRule(
        /\s?--\s?/g,
        (m) => '—',
        'punctuation',
        'Em dash'
    )

    // B. Spelling
    const commonTypos = [
        ['teh', 'the'],
        ['recieve', 'receive'],
        ['occured', 'occurred'] // Corrected typo in logic previously? 'occurred' is correct word.
    ]

    for (const [typo, fix] of commonTypos) {
        applyRegexRule(
            new RegExp(`\\b${typo}\\b`, 'gi'),
            (m) => {
                const original = m[0]
                if (original[0] && original[0] === original[0].toUpperCase()) {
                    return fix.charAt(0).toUpperCase() + fix.slice(1)
                }
                return fix
            },
            'spelling',
            `Corrected spelling`
        )
    }

    // C. Quotes
    applyRegexRule(/"(?=\w)/g, () => '“', 'punctuation', 'Smart quote open')
    applyRegexRule(/(?<=\w)"/g, () => '”', 'punctuation', 'Smart quote closed')

    // D. Double spaces
    applyRegexRule(/ {2,}/g, () => ' ', 'formatting', 'Single space')

    return { revised, changes }
}

const input = `This is  a test. It occured yesterday. "Hello" he said -- or did he? I definitely recieve it.`
console.log("Input:", input)
const result = applyCheapRules(input)
console.log("Output:", result.revised)
console.log("Changes:", result.changes.length)
result.changes.forEach(c => console.log(`- ${c.before} -> ${c.after} (${c.reason})`))

if (result.revised === `This is a test. It occurred yesterday. “Hello” he said—or did he? I definitely receive it.` && result.changes.length === 6) {
    console.log("PASS")
} else {
    console.log("FAIL")
}
