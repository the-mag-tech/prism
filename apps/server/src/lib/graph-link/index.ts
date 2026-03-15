
import { GraphReader } from './reader.js';
import { GraphWriter } from './writer.js';

import { createIronyAtom } from './atoms/irony.js';
import { createEvidenceAtom } from './atoms/evidence.js';
import { createEmotionalAtom } from './atoms/emotional.js';
import { createCausalAtom } from './atoms/causal.js';
import { createEntityExtractionAtom } from './atoms/entity-extraction.js';
import { createSerendipityAtom } from './atoms/serendipity.js';

// Global Singleton Instances
export const graphReader = new GraphReader();
export const graphWriter = new GraphWriter();

// Register Atoms (Full Spectrum + Entity Extraction + Serendipity)
graphWriter.use(createEntityExtractionAtom(graphWriter)); // Entity + Relation Extraction
graphWriter.use(createSerendipityAtom());                 // Serendipity (Graph-based surprise)
graphWriter.use(createIronyAtom(graphWriter));            // Level 4 (Irony)
graphWriter.use(createCausalAtom(graphWriter));           // Level 3 (Logic)
graphWriter.use(createEmotionalAtom(graphWriter));        // Level 2 (Humanity)
graphWriter.use(createEvidenceAtom(graphWriter));         // Level 1 (Facts)

export * from './types.js';
export * from './equivalence.js';
export { GraphReader, GraphWriter };
