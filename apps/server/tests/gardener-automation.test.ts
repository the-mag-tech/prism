/**
 * Curator (Gardener) Automation Tests
 * 
 * Tests the trust metrics and diagnosis behavior of the Curator agent.
 * 
 * Note: These tests mock at the module level to avoid directly accessing
 * private properties of CuratorAgent. The tests focus on observable behavior
 * (database state changes) rather than implementation details.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { initDB, closeDB, getDB } from '../src/db.js';

// Create mock functions
const mockFindAndRecordCandidates = mock(() => Promise.resolve([]));
const mockFindDuplicateMemories = mock(() => Promise.resolve([]));
const mockRejectCandidate = mock(() => {});
const mockGetPendingCandidates = mock(() => []);
const mockCreate = mock(() => Promise.resolve({ choices: [] }));

// Mock the entire deduplicator module
mock.module('../src/lib/agents/curator/deduplicator.js', () => {
    return {
        DeduplicatorService: class {
            findAndRecordCandidates = mockFindAndRecordCandidates;
            rejectCandidate = mockRejectCandidate;
            findDuplicateMemories = mockFindDuplicateMemories;
            getPendingCandidates = mockGetPendingCandidates;
        }
    };
});

// Mock OpenAI via ai-clients
mock.module('../src/lib/ai-clients.js', () => {
    return {
        getOpenAI: () => ({
            chat: {
                completions: {
                    create: mockCreate
                }
            },
            embeddings: {
                create: async () => ({ data: [] })
            }
        })
    };
});

// Import after mocks are set up
import { CuratorAgent } from '../src/lib/agents/curator/agent.js';

const TEST_DB_PATH = ':memory:';

describe('Curator Automation (Trust & Diagnosis)', () => {
    let agent: CuratorAgent;

    beforeEach(() => {
        initDB(TEST_DB_PATH);
        agent = new CuratorAgent();
        // Reset mocks
        mockFindAndRecordCandidates.mockReset();
        mockFindDuplicateMemories.mockReset();
        mockRejectCandidate.mockReset();
        mockGetPendingCandidates.mockReset();
        mockCreate.mockReset();
        
        // Set default implementations
        mockFindAndRecordCandidates.mockImplementation(() => Promise.resolve([]));
        mockFindDuplicateMemories.mockImplementation(() => Promise.resolve([]));
        mockGetPendingCandidates.mockImplementation(() => []);
    });

    afterEach(() => {
        closeDB();
    });

    it('should respect trust metrics threshold', async () => {
        // Seed entities
        const db = getDB();
        db.query(`INSERT INTO entities (id, title, tag) VALUES ('a', 'Apple', 'org')`).run();
        db.query(`INSERT INTO entities (id, title, tag) VALUES ('b', 'Apple Inc', 'org')`).run();

        // Setup mock: deduplicator finds candidates
        const mockPairs = [{
            id: 1,
            entityA: 'a', titleA: 'Apple', sourceDomainA: 'web',
            entityB: 'b', titleB: 'Apple Inc', sourceDomainB: 'web',
            similarity: 0.96
        }];
        mockFindAndRecordCandidates.mockImplementation(() => Promise.resolve(mockPairs));

        // Mock OpenAI diagnosis to say 'MERGE'
        mockCreate.mockImplementation(() => Promise.resolve({
            choices: [{
                message: { content: JSON.stringify({ decision: 'MERGE' }) }
            }]
        }));

        // Run agent
        await agent.run(false);

        // Should call OpenAI because 0.96 > 0.95 (default threshold)
        expect(mockCreate).toHaveBeenCalled();

        // Should merge using 'auto_llm'
        const history = db.query(`SELECT * FROM merge_history`).all() as any[];
        expect(history.length).toBe(1);
        expect(history[0].decided_by).toBe('auto_llm');

        // Trust Metric should be recorded
        const metrics = db.query(`SELECT * FROM trust_metrics`).all() as any[];
        expect(metrics.length).toBe(1);
        expect(metrics[0].method).toBe('auto_llm');
    });

    it('should skip cross-source pairs regardless of similarity', async () => {
        // Setup mock: cross-source pair (different domains)
        const mockPairs = [{
            id: 2,
            entityA: 'x', titleA: 'X', sourceDomainA: 'domain1',
            entityB: 'y', titleB: 'X', sourceDomainB: 'domain2',
            similarity: 0.999 // Very high but cross-source
        }];
        mockFindAndRecordCandidates.mockImplementation(() => Promise.resolve(mockPairs));

        await agent.run(false);

        // Should NOT merge (cross-source protection)
        const db = getDB();
        const history = db.query(`SELECT * FROM merge_history`).all();
        expect(history.length).toBe(0);

        // Should NOT call OpenAI for cross-source pairs
        expect(mockCreate).not.toHaveBeenCalled();
    });
});
