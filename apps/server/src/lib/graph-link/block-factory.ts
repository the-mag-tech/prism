import { getDB } from '../../db.js';

export interface BlockOptions {
    isHeader?: boolean;
    isSource?: boolean;
    colorOverride?: string | null;
    target?: string | null;
}

/**
 * BlockFactory - Single Source of Truth for Page Layout
 * 
 * Unifies logic between Batch Extract and Realtime Ingest to ensure
 * all Entity Pages have consistent structure (Header -> Source -> Related).
 */
export class BlockFactory {

    /**
     * Add a block to a page if it doesn't exist.
     * Thread-safe-ish (uses direct DB queries).
     */
    static addBlockIfMissing(pageId: string, blockId: string, opts: BlockOptions = {}): boolean {
        const db = getDB();

        // 1. Check existence
        const exists = db.query(`SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ?`)
            .get(pageId, blockId);

        if (exists) return false;

        // 2. Get max position
        const row = db.query(`SELECT COALESCE(MAX(position), -1) as max_pos FROM page_blocks WHERE page_id = ?`)
            .get(pageId) as { max_pos: number };

        const nextPos = row.max_pos + 1;

        // 3. Insert
        db.query(`
            INSERT INTO page_blocks (page_id, block_id, position, is_header, is_source, color_override, target)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            pageId,
            blockId,
            nextPos,
            opts.isHeader ? 1 : 0,
            opts.isSource ? 1 : 0,
            opts.colorOverride ?? null,
            opts.target ?? null
        );

        return true;
    }

    /**
     * Ensure an Entity Page has the standard "Hero" structure.
     * 
     * Layout:
     * [0] Header (The Entity itself)
     * [1] Source (The Memory that created it)
     * 
     * @param entityId - The entity ID (e.g. "person:julian")
     * @param sourceMemoryId - The raw memory ID (e.g. 123)
     */
    static ensureEntityPageStructure(entityId: string, sourceMemoryId: number | string) {
        // Handle both "123" and "memory:123" formats for convenience
        const memoryEntityId = String(sourceMemoryId).startsWith('memory:')
            ? String(sourceMemoryId)
            : `memory:${sourceMemoryId}`;

        // 1. Header Block (Block 0)
        this.addBlockIfMissing(entityId, entityId, { isHeader: true });

        // 2. Source Memory Block (Block 1)
        this.addBlockIfMissing(entityId, memoryEntityId, { isSource: true, target: memoryEntityId });
    }

    /**
     * Bi-directionally link a Memory and an Entity.
     * 
     * 1. Memory Page gets Entity Block
     * 2. Entity Page gets Memory Block (Source) - via ensureEntityPageStructure
     */
    static linkMemoryToEntity(memoryId: number | string, entityId: string) {
        const memoryEntityId = String(memoryId).startsWith('memory:')
            ? String(memoryId)
            : `memory:${memoryId}`;

        // 1. Add Entity to Memory Page
        this.addBlockIfMissing(memoryEntityId, entityId, { target: entityId });

        // 2. Ensure Entity Page points back
        this.ensureEntityPageStructure(entityId, memoryEntityId);
    }
}
