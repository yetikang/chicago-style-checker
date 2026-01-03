const normalizeForMatching = (str) => {
    return str
        .replace(/[.,;:"'?!()[\]{}]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ')
        .replace(/[–—]/g, '-')
        .trim()
        .toLowerCase()
}

const locateChange = (revisedText, change) => {
    const searchText = change.after.trim()

    const isContextMatch = (index, useStrict) => {
        const contextBefore = change.context_before.trim()
        const contextAfter = change.context_after.trim()

        const beforeText = revisedText.substring(
            Math.max(0, index - Math.max(contextBefore.length, 40)),
            index
        )
        const afterText = revisedText.substring(
            index + searchText.length,
            index + searchText.length + Math.max(contextAfter.length, 40)
        )

        const normalizedBefore = normalizeForMatching(beforeText)
        const normalizedAfter = normalizeForMatching(afterText)
        const normalizedContextBefore = normalizeForMatching(contextBefore)
        const normalizedContextAfter = normalizeForMatching(contextAfter)

        console.log(`Checking match at index ${index}:`)
        console.log(`  Before: "${normalizedBefore}" vs Context: "${normalizedContextBefore}"`)
        console.log(`  After:  "${normalizedAfter}"  vs Context: "${normalizedContextAfter}"`)

        const beforeMatches =
            contextBefore.length === 0 ||
            normalizedBefore.endsWith(
                normalizedContextBefore.slice(-Math.min(normalizedContextBefore.length, 25))
            )

        const afterMatches =
            contextAfter.length === 0 ||
            normalizedAfter.startsWith(
                normalizedContextAfter.slice(0, Math.min(normalizedContextAfter.length, 25))
            )

        console.log(`  Result: Before=${beforeMatches}, After=${afterMatches}, Strict=${useStrict}`)

        return useStrict ? (beforeMatches && afterMatches) : (beforeMatches || afterMatches)
    }

    // Strategy 1: Strict
    let searchStart = 0
    while (searchStart < revisedText.length) {
        const index = revisedText.indexOf(searchText, searchStart)
        if (index === -1) break
        if (isContextMatch(index, true)) return { start: index, end: index + searchText.length, strategy: 'strict' }
        searchStart = index + 1
    }

    // Strategy 2: Relaxed
    searchStart = 0
    while (searchStart < revisedText.length) {
        const index = revisedText.indexOf(searchText, searchStart)
        if (index === -1) break
        if (isContextMatch(index, false)) return { start: index, end: index + searchText.length, strategy: 'relaxed' }
        searchStart = index + 1
    }

    // Strategy 3: Unique
    const firstIndex = revisedText.indexOf(searchText)
    if (firstIndex !== -1 && revisedText.indexOf(searchText, firstIndex + 1) === -1) {
        return { start: firstIndex, end: firstIndex + searchText.length, strategy: 'unique' }
    }

    return null
}

// Test Case
const revisedText = "Henceforth I refer to them, as Quisay does, as “the Shaykhs.”"
const change = {
    after: "as",
    context_before: "them",  // Model expects no comma
    context_after: "Quisay"
}

console.log("Locating change...")
const result = locateChange(revisedText, change)
console.log("Found:", result)
