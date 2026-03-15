import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { initDB, closeDB } from '../src/db.js';

// Create mock functions
const mockChatCreate = mock(() => Promise.resolve({ choices: [] }));
const mockIngestFinding = mock(() => Promise.resolve(1));
const mockResolveEntity = mock(() => null);
const mockEnrichContext = mock(() => '');
const mockGetFingerprint = mock(() => ({ fingerprint: '', relatedTerms: [] }));
const mockCalculateSurprise = mock(() => Promise.resolve({ score: 0.8, reason: 'Novel content' }));

// Mock AI clients
mock.module('../src/lib/ai-clients.js', () => ({
    getOpenAI: () => ({
        chat: {
            completions: {
                create: mockChatCreate,
            },
        },
        embeddings: {
            create: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] })
        }
    })
}));

// Mock search-service (instead of low-level @tavily/core)
mock.module('../src/lib/search-service.js', () => ({
    search: async () => ({
        success: true,
        query: 'test',
        results: [
            { title: 'Test Result', url: 'https://test.com', content: 'Test content' }
        ],
        totalCount: 1,
        provider: 'tavily',
        latencyMs: 100
    }),
    isSearchAvailable: () => true,
    getSearchService: () => null,
}));

// Mock singleton dependencies
mock.module('../src/lib/graph-link/index.js', () => ({
    graphReader: {
        resolveEntity: (...args: any[]) => mockResolveEntity(...args),
        enrichContext: (...args: any[]) => mockEnrichContext(...args),
        getFingerprint: (...args: any[]) => mockGetFingerprint(...args),
        calculateSurprise: (...args: any[]) => mockCalculateSurprise(...args),
    },
    graphWriter: {
        ingestFinding: (...args: any[]) => mockIngestFinding(...args),
    }
}));

import { IntentExtractor } from '../src/lib/agents/explorer/intent-extractor.js';
import { DeepExplorer } from '../src/lib/agents/explorer/engine.js';

describe('Deep Explorer Graph Integration', () => {

    beforeEach(() => {
        initDB(':memory:');
        // Reset mocks
        mockChatCreate.mockReset();
        mockIngestFinding.mockReset();
        mockResolveEntity.mockReset();
        mockEnrichContext.mockReset();
        mockGetFingerprint.mockReset();
        mockCalculateSurprise.mockReset();
        
        // Default mock implementations
        mockIngestFinding.mockImplementation(() => Promise.resolve(1));
        mockGetFingerprint.mockReturnValue({
            fingerprint: 'Test fingerprint',
            relatedTerms: ['term1', 'term2']
        });
        // Default mock for calculateSurprise - high score to ensure findings are ingested
        mockCalculateSurprise.mockImplementation(() => Promise.resolve({
            score: 0.8, // Above 0.3 threshold
            reason: 'Novel content'
        }));
    });

    afterEach(() => {
        closeDB();
    });

    it('should enrich intent when entity exists in graph', async () => {
        // 1. Mock Graph Data Return
        mockResolveEntity.mockReturnValue({
            id: 'concept:magic_rain',
            title: 'Magic Rain'
        });
        // Note: IntentExtractor now uses getFingerprint instead of enrichContext
        mockGetFingerprint.mockReturnValue({
            fingerprint: 'Detailed analysis of the rain',
            relatedTerms: ['magic', 'scene']
        });

        // 2. Mock OpenAI Response for IntentExtractor
        mockChatCreate.mockImplementation(() => Promise.resolve({
            choices: [{
                message: {
                    content: JSON.stringify({
                        coreObject: 'Magic Rain',
                        context: 'Movie context',
                        desiredDepth: 'scene_analysis'
                    })
                }
            }]
        }));

        // 3. Execute Extraction
        const extractor = new IntentExtractor();
        const intent = await extractor.extract('Tell me about Magic Rain');

        // 4. Verify Enrichment - uses getFingerprint now
        expect(mockResolveEntity).toHaveBeenCalledWith('Magic Rain');
        expect(mockGetFingerprint).toHaveBeenCalledWith('concept:magic_rain');
        expect(intent.context).toContain('[Known Context]');
        expect(intent.context).toContain('Detailed analysis');
        expect(intent.context).toContain('[Related Concepts]');
    });

    it('should ingest findings into graph during exploration', async () => {
        // 1. Mock OpenAI for DeepExplorer
        const explorer = new DeepExplorer();

        // Mock Query Analysis
        // @ts-ignore
        explorer.queryAnalyzer = {
            analyze: mock(() => Promise.resolve({
                queryType: 'exploratory',
                recommendedConfig: { mode: 'fast', strategy: 'irony', targetLevel: 1, width: 1, maxRounds: 0 }
            }))
        };

        // Mock Intent Extraction
        // @ts-ignore
        explorer.intentExtractor = {
            extract: mock(() => Promise.resolve({
                coreObject: 'Test Object',
                context: 'Test Context',
                searchQueries: ['query'],
                desiredDepth: 'general'
            }))
        };

        // Mock Direction Generation - OpenAI is now mocked via ai-clients.js
        mockChatCreate.mockImplementation(() => Promise.resolve({
            choices: [{
                message: { content: JSON.stringify({ directions: [{ name: 'Test Dir', queries: ['test query'] }] }) }
            }]
        }));

        // 2. Execute Exploration
        await explorer.explore('test topic', {
            strategy: {
                name: 'mock',
                evaluate: mock(() => Promise.resolve({ total: 10, level: 1 })),
                getNextDirections: mock(() => Promise.resolve([])),
                isComplete: () => true,
                format: mock(() => Promise.resolve('output'))
            } as any,
            config: { targetLevel: 1, maxRounds: 0, width: 1 }
        });

        // 3. Verify Ingestion
        expect(mockIngestFinding).toHaveBeenCalled();
        expect(mockIngestFinding).toHaveBeenCalledWith(
            'https://test.com',
            'Test Result',
            'Test content',
            expect.any(Array)
        );
    });
});
