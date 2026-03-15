import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { initDB, getDB, closeDB } from '../src/db.js';
import { GraphReader, GraphWriter } from '../src/lib/graph-link/index.js';

const TEST_DB_PATH = ':memory:';

describe('Graph Link Layer', () => {
    let reader: GraphReader;
    let writer: GraphWriter;

    beforeEach(() => {
        initDB(TEST_DB_PATH);
        reader = new GraphReader();
        writer = new GraphWriter();
    });

    afterEach(() => {
        closeDB(); // Close connection first
    });

    it('should upsert and resolve an entity', () => {
        const entity = {
            id: 'person:test_user',
            title: 'Test User',
            subtitle: 'A test user',
            body: 'This is a test body content',
            type: 'person'
        };

        writer.upsertEntity(entity);

        const resolved = reader.resolveEntity('Test User');
        expect(resolved).toBeTruthy();
        expect(resolved?.id).toBe(entity.id);
        expect(resolved?.title).toBe(entity.title);
    });

    it('should ingest a finding and trigger event', async () => {
        const mockListener = mock(() => {});
        writer.on('ingest', mockListener);

        const memoryId = await writer.ingestFinding(
            'https://example.com/finding',
            'Test Finding',
            'Test content',
            ['person:test_user']
        );

        expect(memoryId).toBeGreaterThan(0);
        expect(mockListener).toHaveBeenCalledTimes(1);
        // URL starts with https:// so entityPrefix is 'finding'
        expect(mockListener).toHaveBeenCalledWith(expect.objectContaining({
            type: 'finding',
            id: memoryId
        }));
    });

    it('should add annotation and trigger event', () => {
        const entityId = 'person:annotated_user';
        writer.upsertEntity({
            id: entityId,
            title: 'Annotated User',
            type: 'person'
        });

        const mockListener = mock(() => {});
        writer.on('annotation', mockListener);

        const annotation = {
            entityId,
            key: 'irony' as const,
            value: { score: 0.9, reason: 'Test irony' },
            createdAt: new Date().toISOString()
        };

        writer.addAnnotation(annotation);

        const db = getDB();
        const row = db.query('SELECT value FROM entity_metadata WHERE entity_id = ? AND key = ?').get(entityId, 'irony') as any;
        expect(JSON.parse(row.value)).toEqual(annotation.value);

        expect(mockListener).toHaveBeenCalledWith(annotation);
    });

    it('should enrich context (Fingerprinting)', () => {
        writer.upsertEntity({
            id: 'concept:fingerprint',
            title: 'Unique Fingerprint',
            subtitle: 'Subtitle identifier',
            body: 'Body content body content',
            type: 'concept'
        });

        const context = reader.enrichContext('concept:fingerprint');
        expect(context).toContain('Unique Fingerprint');
        expect(context).toContain('Subtitle identifier');
        expect(context).toContain('Body content');
    });
});
