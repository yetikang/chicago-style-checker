const fs = require('fs');
const path = require('path');

// Mock the environment for route logic
process.env.GEMINI_API_KEY = 'mock-key';

// Import the logic we want to test
// Note: We'll use a modified version of the mock_route_logic.js to match the NEW schema
const mockLogic = require('./mock_route_logic.js');

async function verify() {
    console.log("--- Starting Schema Verification ---");

    const inputText = "This is a test:with a colon and space.";
    const revisedText = "This is a test: with a colon and space.";

    // Simulate what the backend does
    let changes = [];

    // 1. applyCheapRules
    changes = mockLogic.applyCheapRules(revisedText);
    console.log("Changes after applyCheapRules:", JSON.stringify(changes, null, 2));

    // 2. computeMissingChanges (the diff engine)
    const allChanges = mockLogic.computeMissingChanges(inputText, revisedText, changes);
    console.log("All changes after computeMissingChanges:", JSON.stringify(allChanges, null, 2));

    // 3. processAndFinalizeChanges
    const finalChanges = mockLogic.processAndFinalizeChanges(allChanges);
    console.log("Finalized changes:", JSON.stringify(finalChanges, null, 2));

    // Verification queries
    const hasId = finalChanges.every(c => c.id && typeof c.id === 'string');
    const hasBeforeText = finalChanges.every(c => typeof c.before_text === 'string');
    const hasAfterText = finalChanges.every(c => typeof c.after_text === 'string');
    const hasHighlights = finalChanges.every(c => Array.isArray(c.highlights));
    const hasNoLoc = finalChanges.every(c => !c.loc);
    const hasNoBefore = finalChanges.every(c => !c.before);

    console.log("\n--- Verification Results ---");
    console.log("All changes have 'id':", hasId);
    console.log("All changes have 'before_text':", hasBeforeText);
    console.log("All changes have 'after_text':", hasAfterText);
    console.log("All changes have 'highlights' array:", hasHighlights);
    console.log("No changes have deprecated 'loc':", hasNoLoc);
    console.log("No changes have deprecated 'before':", hasNoBefore);

    if (hasId && hasBeforeText && hasAfterText && hasHighlights && hasNoLoc && hasNoBefore) {
        console.log("\nSUCCESS: API Response conform to the new schema.");
    } else {
        console.log("\nFAILURE: Schema mismatch detected.");
        process.exit(1);
    }
}

verify().catch(err => {
    console.error(err);
    process.exit(1);
});
