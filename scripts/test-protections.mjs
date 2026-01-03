// Node 24+ has global fetch

// BASE_URL is set in runAll()

async function testProtections() {
    console.log('--- STARTING PROTECTION TESTS ---');
    let cookies = '';

    const callApi = async (text, headers = {}) => {
        const resp = await fetch(global.BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookies,
                ...headers
            },
            body: JSON.stringify({ text })
        });

        const setCookie = resp.headers.get('set-cookie');
        if (setCookie) {
            // Very basic cookie parsing for anon_id
            const match = setCookie.match(/anon_id=([^;]+)/);
            if (match) cookies = `anon_id = ${match[1]} `;
        }
        return resp;
    };

    // 1. Test Mock Mode Bypass (Server should have COUNT_MOCK_AS_EXPENSIVE=0)
    console.log('\n[Test 1] Mock Mode Bypass (Default)');
    for (let i = 0; i < 5; i++) {
        const resp = await callApi(`Mock request ${i} `);
        console.log(`Request ${i}: Status ${resp.status} `);
        if (resp.status === 429) {
            console.error('FAIL: Triggered rate limit in mock mode with bypass enabled');
            process.exit(1);
        }
    }
    console.log('PASS: Mock mode bypassed limiter');

    // 2. Test Cache Hit Bypass
    console.log('\n[Test 2] Cache Hit Bypass');
    const testText = "Identical cache test text.";

    const r1 = await callApi(testText);
    console.log(`First request(Miss): Status ${r1.status}, X - Cache: ${r1.headers.get('x-cache')} `);

    const r2 = await callApi(testText);
    console.log(`Second request(Hit): Status ${r2.status}, X - Cache: ${r2.headers.get('x-cache')} `);

    if (r2.headers.get('x-cache') !== 'HIT') {
        console.error('FAIL: Second request was not a cache hit');
    } else {
        console.log('PASS: Cache hit correctly identified');
    }

    // 3. Test x-cache-bypass: 1 logic
    console.log('\n[Test 3] x-cache-bypass header');
    const r3 = await callApi(testText, { 'x-cache-bypass': '1' });
    console.log(`Bypass request: Status ${r3.status}, X - Cache: ${r3.headers.get('x-cache')} `);
    if (r3.headers.get('x-cache') === 'MISS') {
        console.log('PASS: x-cache-bypass: 1 forced a MISS');
    } else {
        console.error('FAIL: x-cache-bypass: 1 did not force a MISS');
    }

    console.log('\n--- PROTECTION TESTS COMPLETE (PHASE 1) ---');
}

async function testExpensiveMock() {
    console.log('\n--- STARTING EXPENSIVE MOCK TESTS (PHASE 2) ---');
    console.log('Expectation: COUNT_MOCK_AS_EXPENSIVE=1, RATE_USER_30S=2');
    let cookies = '';

    const callApi = async (text, headers = {}) => {
        const resp = await fetch(global.BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookies,
                ...headers
            },
            body: JSON.stringify({ text })
        });

        const setCookie = resp.headers.get('set-cookie');
        if (setCookie) {
            const match = setCookie.match(/anon_id=([^;]+)/);
            if (match) cookies = `anon_id=${match[1]}`;
        }
        return resp;
    };

    /*
        // 1. Trigger Limiter
        console.log('\n[Test 4] Trigger Limiter for Expensive Mock');
        const r1 = await callApi("Req 1");
        console.log(`Req 1: Status ${r1.status}`);
        const r2 = await callApi("Req 2");
        console.log(`Req 2: Status ${r2.status}`);
        const r3 = await callApi("Req 3");
        console.log(`Req 3: Status ${r3.status} (Expected 429)`);
    
        if (r3.status === 429) {
            console.log('PASS: Limiter triggered for expensive mock');
        } else {
            console.error(`FAIL: Limiter DID NOT trigger (Status: ${r3.status})`);
            process.exit(1);
        }
    
        // 2. Cache Hit should STILL pass even if rate limited (because it returns BEFORE limiter consumption)
        console.log('\n[Test 5] Cache Hit vs Limiter');
        // We'll use text from "Req 1" which is already cached
        const r4 = await callApi("Req 1");
        console.log(`Req 1 (Cache Hit): Status ${r4.status}, X-Cache: ${r4.headers.get('x-cache')}`);
        if (r4.status === 200 && r4.headers.get('x-cache') === 'HIT') {
            console.log('PASS: Cache hit bypassed limiter even while over quota');
        } else {
            console.error(`FAIL: Cache hit was blocked or missed (Status: ${r4.status}, X-Cache: ${r4.headers.get('x-cache')})`);
            process.exit(1);
        }
    
        // 3. Rules-Only Return
        console.log('\n[Test 6] x-rules-only header');
        const r5 = await callApi("This is teh test.", { 'x-rules-only': '1' });
        console.log(`Rules-only request: Status ${r5.status}, X-Rules-Only: ${r5.headers.get('x-rules-only')}`);
        if (r5.headers.get('x-rules-only') === 'HIT') {
            console.log('PASS: x-rules-only: 1 returned early from Phase C');
        } else {
            console.error(`FAIL: x-rules-only: 1 did not return early (X-Rules-Only: ${r5.headers.get('x-rules-only')})`);
            process.exit(1);
        }
    */

    // 4. Multi-Provider & Schema Validation
    console.log('\n[Test 7] Multi-provider & Schema Validation');
    cookies = ''; // FRESH USER to avoid rate limit from Test 4
    const r6 = await callApi(`Schema validation unique test string ${Date.now()}`);
    const data6 = await r6.json();
    const providerHeader = r6.headers.get('x-provider');
    const modelHeader = r6.headers.get('x-model');

    console.log(`Provider: ${providerHeader}, Model: ${modelHeader}`);

    if (providerHeader && modelHeader && data6.revised_text && Array.isArray(data6.changes)) {
        console.log('PASS: Provider headers present and JSON schema is valid');
    } else {
        console.error('FAIL: Missing headers or invalid JSON schema');
        console.error(JSON.stringify(data6, null, 2));
        process.exit(1);
    }

    console.log('\n--- PROTECTION TESTS COMPLETE (PHASE 2) ---');
}

async function runAll() {
    const port = process.argv.find(a => !isNaN(a)) || '3000';
    global.BASE_URL = `http://localhost:${port}/api/rewrite`;
    console.log(`Targeting: ${global.BASE_URL}`);

    await testExpensiveMock(); // This will run Test 7
}

runAll().catch(e => {
    console.error(e);
    process.exit(1);
});
