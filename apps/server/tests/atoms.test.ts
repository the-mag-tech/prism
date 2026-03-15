/**
 * Atoms: Irony Middleware Tests
 * 
 * Tests the irony detection middleware for graph ingestion.
 * 
 * Note: The middleware chain includes multiple atoms (irony, causal, emotional, evidence).
 * These tests specifically verify the irony atom behavior by querying for key='irony'.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { initDB, closeDB, getDB } from '../src/db.js';

// Create mock functions
const mockEvaluate = mock(() => Promise.resolve({
    level: 3,
    total: 35,
    reason: 'Very ironic situation',
    dimensions: { surprise: 8, ironyDepth: 9 }
}));

// Mock Irony Strategy
mock.module('../src/lib/agents/explorer/strategies/irony.js', () => ({
    ironyStrategy: {
        evaluate: mockEvaluate,
    }
}));

// Mock AI clients to prevent real API calls
mock.module('../src/lib/ai-clients.js', () => ({
    getOpenAI: () => ({
        chat: {
            completions: {
                create: async () => ({
                    choices: [{
                        message: { content: '{}' }
                    }]
                })
            }
        },
        embeddings: {
            create: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] })
        }
    })
}));

// Import after mocks
import { graphWriter } from '../src/lib/graph-link/index.js';
import { ironyStrategy } from '../src/lib/agents/explorer/strategies/irony.js';

const TEST_DB_PATH = ':memory:';

describe('Atoms: Irony Middleware', () => {

    beforeEach(() => {
        initDB(TEST_DB_PATH);
        // Reset mock to default high score
        mockEvaluate.mockImplementation(() => Promise.resolve({
            level: 3,
            total: 35,
            reason: 'Very ironic situation',
            dimensions: { surprise: 8, ironyDepth: 9 }
        }));
    });

    afterEach(() => {
        closeDB();
    });

    it('should analyze content and annotate if irony is detected', async () => {
        // 1. Mock Irony Strategy to return High Score (already set in beforeEach)

        // 2. Ingest finding (triggers middleware)
        const content = "The fire station burned down due to a fire safety system malfunction.";
        const memoryId = await graphWriter.ingestFinding('http://irony.com', 'Fire Station Burns', content);

        // 3. Verify Strategy was called
        expect(ironyStrategy.evaluate).toHaveBeenCalled();

        // 4. Verify Irony Annotation in DB (specifically query for irony key)
        const db = getDB();
        const entityId = `finding:${memoryId}`; // Scout findings use 'finding:' prefix
        const meta = db.query(`SELECT * FROM entity_metadata WHERE entity_id = ? AND key = 'irony'`).get(entityId) as any;

        expect(meta).toBeDefined();
        expect(meta.key).toBe('irony');
        const value = JSON.parse(meta.value);
        expect(value.score).toBe(35);
        expect(value.reason).toBe('Very ironic situation');
    });

    it('should skip irony annotation if irony score is low', async () => {
        // 1. Mock Irony Strategy to return Low Score (< Level 2)
        mockEvaluate.mockImplementation(() => Promise.resolve({
            level: 1,
            total: 10,
            reason: 'Not very ironic',
            dimensions: { surprise: 2, ironyDepth: 2 }
        }));

        // 2. Ingest
        const content = "The sun rose in the east today as expected. It was a completely normal day with nothing unusual happening at all.";
        const memoryId = await graphWriter.ingestFinding('http://boring.com', 'Sun Rise', content);

        // 3. Verify Strategy called
        expect(ironyStrategy.evaluate).toHaveBeenCalled();

        // 4. Verify NO Irony Annotation (other atoms may still create their annotations)
        const db = getDB();
        const entityId = `finding:${memoryId}`;
        const ironyMeta = db.query(`SELECT * FROM entity_metadata WHERE entity_id = ? AND key = 'irony'`).get(entityId);
        expect(ironyMeta).toBeFalsy();
    });
});
