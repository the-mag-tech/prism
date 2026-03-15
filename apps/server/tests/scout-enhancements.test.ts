import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';

// Create mock functions
const mockGetEntity = mock(() => null);
const mockEnrichContext = mock(() => '');
const mockGetRelations = mock(() => []);
const mockResolveEntity = mock(() => null);
const mockGetFingerprint = mock(() => ({ fingerprint: '', relatedTerms: [] }));
const mockRecordActivity = mock(() => {});
const mockIngestFinding = mock(() => Promise.resolve(1));

// Mock AI clients - used by ScoutQueryGenerator
mock.module('../src/lib/ai-clients.js', () => ({
    getOpenAI: () => ({
        chat: {
            completions: {
                create: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({ queries: ['test query 1', 'test query 2'] })
                        }
                    }]
                })
            }
        },
        embeddings: {
            create: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] })
        }
    })
}));

mock.module('../src/lib/graph-link/index.js', () => ({
    graphReader: {
        getEntity: mockGetEntity,
        enrichContext: mockEnrichContext,
        getRelations: mockGetRelations,
        resolveEntity: mockResolveEntity,
        getFingerprint: mockGetFingerprint,
    },
    graphWriter: {
        recordActivity: mockRecordActivity,
        ingestFinding: mockIngestFinding,
    },
    ScoutEntity: {},
}));

import { ScoutAgent } from '../src/lib/agents/scout/agent.js';
import { graphReader, graphWriter } from '../src/lib/graph-link/index.js';

describe('Scout Enhancements (Phase 6)', () => {
    let agent: ScoutAgent;

    beforeEach(() => {
        // Reset all mocks
        mockGetEntity.mockReset();
        mockEnrichContext.mockReset();
        mockGetRelations.mockReset();
        mockResolveEntity.mockReset();
        mockGetFingerprint.mockReset();
        mockRecordActivity.mockReset();
        mockIngestFinding.mockReset();

        agent = new ScoutAgent();

        // Mock internal scout method
        spyOn(agent as any, 'scout').mockResolvedValue({
            originalEntity: { name: 'Test', type: 'concept', context: '', searchQuery: '' },
            confidence: 1.0,
            summary: 'Mock finding'
        });
    });

    it('scoutMultiple should process entities in parallel chunks', async () => {
        const ent = (i: number) => ({ name: `E${i}`, type: 'concept' as any, context: '', searchQuery: '' });
        const entities = [ent(1), ent(2), ent(3), ent(4), ent(5)];

        const results = await agent.scoutMultiple(entities, 2);

        expect(results.length).toBe(5);
        expect((agent as any).scout).toHaveBeenCalledTimes(5);
    });

    it('patrol should resolve entity from graph and record activity', async () => {
        const entityId = 'concept:simon';

        // Setup Graph mocks
        mockGetEntity.mockReturnValue({
            id: entityId,
            title: 'Simon',
            type: 'concept'
        });
        mockEnrichContext.mockReturnValue('Simon Context');
        mockGetRelations.mockReturnValue([
            { source: 'concept:simon', target: 'project:datasette', type: 'creator' }
        ]);
        // getFingerprint returns title + relatedTerms
        mockGetFingerprint.mockReturnValue({
            fingerprint: 'Simon Context',
            relatedTerms: ['datasette', 'llm']
        });

        await agent.patrol(entityId);

        // Verify Flow
        expect(mockRecordActivity).toHaveBeenCalledWith(entityId, 'scout');
        expect(mockGetEntity).toHaveBeenCalledWith(entityId);
        expect(mockGetFingerprint).toHaveBeenCalledWith(entityId);

        // Check if scout was called (via the AI-generated queries)
        expect((agent as any).scout).toHaveBeenCalled();
    });

    it('patrol should return null if entity not found', async () => {
        mockGetEntity.mockReturnValue(null);

        const res = await agent.patrol('missing:id');
        expect(res).toBeNull();
        // recordActivity is called BEFORE checking existence to update "last_scouted" 
        // even if fail to find content? 
        // Actually code records activity first. 
        expect(mockRecordActivity).toHaveBeenCalled();
    });
});
