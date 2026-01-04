const fs = require('fs');
const path = require('path');

async function testIdempotency() {
    console.log("--- Starting Idempotency Verification ---");

    // We'll simulate a call to the /api/rewrite with multiple issues
    const inputText = "This is a test:with a typo definitately -- and double space. Also a quote \"here.";

    // Note: Since we can't easily call the actual Next.js API in this environment
    // we'll use a mock that simulates the backend logic flow
    const mockLogic = require('./mock_route_logic.js');

    // Pass 1
    console.log("\nPASS 1: Original -> Revised");
    const ruleResult1 = mockLogic.applyCheapRules(inputText);
    const revised1 = mockLogic.computeMissingChanges(inputText, ruleResult1.revisedText, ruleResult1.changes);
    const finalTextPass1 = ruleResult1.revisedText; // Simple simulation
    console.log("Revised Text (Pass 1):", finalTextPass1);

    // Pass 2 (simulate re-processing the output)
    console.log("\nPASS 2: Revised -> Stability Check");
    const ruleResult2 = mockLogic.applyCheapRules(finalTextPass1);
    const stable = ruleResult2.revisedText === finalTextPass1;

    if (stable) {
        console.log("SUCCESS: Pipeline is idempotent. Re-processing output produced zero changes.");
    } else {
        console.log("FAILURE: Second pass produced more changes.");
        console.log("Pass 2 Output:", ruleResult2.revisedText);
        process.exit(1);
    }
}

testIdempotency().catch(err => {
    console.error(err);
    process.exit(1);
});
