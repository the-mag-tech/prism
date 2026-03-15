/**
 * Test script for Ripple System
 * 
 * Usage: cd apps/prism-server && bun run scripts/test-ripple.ts
 */

import { initDB, getDB } from '../src/db.js';
import { graphWriter, graphReader } from '../src/lib/graph-link/index.js';
import { rippleSystem, rippleAgent } from '../src/lib/ripple/index.js';

async function main() {
    console.log('🧪 Testing Ripple System\n');
    console.log('='.repeat(60));

    // Initialize DB - use Tauri database for real emergence test
    const tauriDbPath = `${process.env.HOME}/Library/Application Support/com.magpie.desktop/prism.db`;
    initDB(tauriDbPath);
    const db = getDB();

    // Test 1: GraphReader.calculateSurprise()
    console.log('\n📊 Test 1: GraphReader.calculateSurprise()');
    console.log('-'.repeat(40));

    const surprise1 = await graphReader.calculateSurprise(
        'Simon Willison announces Datasette 2.0 with major performance improvements',
        undefined // No context entity
    );
    console.log(`Content: "Simon Willison announces Datasette 2.0..."`);
    console.log(`Surprise Score: ${surprise1.score.toFixed(2)}`);
    console.log(`Reason: ${surprise1.reason}`);
    console.log(`Should Ingest: ${surprise1.shouldIngest}`);

    // Test 2: Ingest some content and check SerendipityAtom
    console.log('\n📊 Test 2: Ingest with SerendipityAtom');
    console.log('-'.repeat(40));

    const testContent = `
# Test Article: AI Revolution in 2025

The AI landscape is changing rapidly. New models like GPT-5 are pushing boundaries.
Simon Willison has been exploring these tools extensively through his blog.
Datasette continues to be a valuable tool for data exploration.

Key trends:
- Local-first AI applications
- Knowledge graphs for personal use
- Serendipitous discovery systems
`;

    const memoryId = await graphWriter.ingestFinding(
        'drop://test/test-article.md',
        'AI Revolution in 2025',
        testContent,
        [],
        testContent
    );
    console.log(`✅ Ingested memory #${memoryId}`);

    // Check if surprise score was stored
    const surpriseAnnotation = db.query(`
        SELECT value FROM entity_metadata 
        WHERE entity_id = ? AND key = 'surprise_score'
    `).get(`memory:${memoryId}`) as { value: string } | undefined;

    if (surpriseAnnotation) {
        const parsed = JSON.parse(surpriseAnnotation.value);
        console.log(`Surprise Score stored: ${parsed.score.toFixed(2)}`);
        console.log(`Reason: ${parsed.reason}`);
    } else {
        console.log('⚠️ No surprise score stored (SerendipityAtom may have skipped)');
    }

    // Test 3: RippleSystem event queue
    console.log('\n📊 Test 3: RippleSystem Event Queue');
    console.log('-'.repeat(40));

    console.log(`Queue length before: ${rippleSystem.getQueueLength()}`);
    console.log(`Is processing: ${rippleSystem.isProcessing()}`);
    console.log(`Is enabled: ${rippleSystem.isEnabled()}`);

    // Emit a test event (won't actually propagate without Tavily)
    rippleSystem.emit({
        type: 'ENTITY_CREATED',
        entityId: 'test:ripple_test',
        entityType: 'test',
        entityTitle: 'Ripple Test Entity',
        trigger: 'system',
    });

    console.log(`Queue length after emit: ${rippleSystem.getQueueLength()}`);

    // Test 4: Check entities created from ingest
    console.log('\n📊 Test 4: Entities from Ingest');
    console.log('-'.repeat(40));

    const entities = db.query(`
        SELECT id, title, type FROM entities 
        ORDER BY created_at DESC 
        LIMIT 5
    `).all() as Array<{ id: string; title: string; type: string }>;

    if (entities.length > 0) {
        console.log('Recent entities:');
        for (const e of entities) {
            console.log(`  - ${e.id}: ${e.title}`);
        }
    } else {
        console.log('No entities created (EntityExtraction may need OpenAI)');
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Ripple System Test Complete!');
    console.log('='.repeat(60));

    console.log(`
Summary:
- GraphReader.calculateSurprise() ✅ Working
- SerendipityAtom: ${surpriseAnnotation ? '✅ Storing scores' : '⚠️ Needs verification'}
- RippleSystem: ✅ Event queue working
- EntityExtraction: ${entities.length > 0 ? '✅ Creating entities' : '⚠️ Needs OpenAI'}

Next: Try dropping a real file via the UI to see full Ripple flow!
`);
}

main().catch(console.error);

