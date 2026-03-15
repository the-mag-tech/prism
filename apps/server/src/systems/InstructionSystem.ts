/**
 * Prism Natural Language Virtual Machine (NL-VM)
 * 
 * CONCEPT:
 * Inspired by RWKV-v8 "Head-wise State Manipulation".
 * Instead of rigid API endpoints, we treat the server as a state machine.
 * 
 * - State: A flowing context object (PrismState)
 * - Heads: Functional units that manipulate the state (Select, Filter, Mutate)
 * - Instructions: The "Assembly Code" compiled from Natural Language
 * 
 * @experimental 2026-01-12
 */

import { getDB } from '../db.js';
import { calculateEntityGravity, GravityCandidate } from './PhysicsSystem.js';
import { AgentLogger } from '../lib/agent-logger.js';
import { randomUUID } from 'crypto';

// =============================================================================
// 1. STATE DEFINITION ( The "RAM" )
// =============================================================================

export interface PrismState {
  // Registers: Control flags and constraints
  registers: {
    timeRange?: { start: Date; end: Date }; // e.g., "Last week"
    limit: number;                          // e.g., "Top 5"
    intent?: string;                        // e.g., "RESEARCH"
    minGravity: number;                     // e.g., "Important only" (>0.8)
  };

  // Focus: The current entities we are "looking at" (Pointers)
  focus: {
    entityIds: string[];
  };

  // Memory: The working buffer for data manipulation
  memory: {
    candidates: Array<any>;      // The raw rows fetched from DB
    results: Array<any>;         // The processed output
    logs: string[];             // Execution trace (Chain of Thought)
  };
}

// =============================================================================
// 2. INSTRUCTION SET ( The "OpCodes" )
// =============================================================================

export type OpCodeType = 
  | 'SET_REGISTER'  // Configure VM
  | 'SELECT'        // Search / Fetch (Read Head)
  | 'FILTER'        // Logic / Physics (Logic Head)
  | 'LINK'          // Connect (Write Head)
  | 'PROJECT'       // Transform / Format (Output Head)
;

export interface Instruction {
  op: OpCodeType;
  params: any;
}

// =============================================================================
// 3. THE VIRTUAL MACHINE
// =============================================================================

export class InstructionSystem {
  private logger = new AgentLogger('vm');

  /**
   * Create a blank state
   */
  createState(): PrismState {
    return {
      registers: {
        limit: 10,
        minGravity: 0.1
      },
      focus: { entityIds: [] },
      memory: { candidates: [], results: [], logs: [] }
    };
  }

  /**
   * Execute a program (Sequence of Instructions)
   */
  async execute(program: Instruction[], initialState?: PrismState): Promise<PrismState> {
    let state = initialState || this.createState();
    const runId = randomUUID().slice(0, 8);

    const handle = this.logger.start('execute', { programLength: program.length, runId });
    this.logger.log(`[VM:${runId}] Starting execution of ${program.length} ops`);

    for (const [index, instr] of program.entries()) {
      try {
        state.memory.logs.push(`[OP:${index}] ${instr.op} ${JSON.stringify(instr.params)}`);
        
        switch (instr.op) {
          case 'SET_REGISTER':
            state = await this.headRegister(state, instr.params);
            break;
          case 'SELECT':
            state = await this.headSelector(state, instr.params);
            break;
          case 'FILTER':
            state = await this.headPhysics(state, instr.params);
            break;
          case 'LINK':
            state = await this.headMutator(state, instr.params);
            break;
          case 'PROJECT':
            state = await this.headProjector(state, instr.params);
            break;
          default:
            this.logger.log(`[WARN] Unknown OpCode: ${(instr as any).op}`);
        }
      } catch (error) {
        this.logger.log(`[ERROR] [VM:${runId}] Crash at OP:${index}`, { error });
        state.memory.logs.push(`[ERROR] ${error}`);
        handle.error(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    }

    this.logger.log(`[VM:${runId}] Halted. Result count: ${state.memory.results.length}`);
    handle.success({ resultCount: state.memory.results.length });
    return state;
  }

  // ===========================================================================
  // 4. THE HEADS ( Functional Units )
  // ===========================================================================

  /**
   * Register Head: Configures the machine's control flags
   * Equivalent to: Setting hyperparameters
   */
  private async headRegister(state: PrismState, params: Partial<PrismState['registers']>): Promise<PrismState> {
    state.registers = { ...state.registers, ...params };
    return state;
  }

  /**
   * Selector Head: Fetches data into memory
   * Equivalent to: Attention Mechanism (Looking at data)
   */
  private async headSelector(state: PrismState, params: { query?: string; type?: string; source?: string }): Promise<PrismState> {
    const db = getDB();
    let sql = `SELECT * FROM entity_profiles WHERE 1=1`;
    const args: any[] = [];

    if (params.type) {
      sql += ` AND id LIKE ?`;
      args.push(`${params.type}:%`);
    }

    if (params.query) {
      // Simple exact match for now, could be FTS
      sql += ` AND (title LIKE ? OR description LIKE ?)`;
      args.push(`%${params.query}%`, `%${params.query}%`);
    }

    // Apply time register if set
    if (state.registers.timeRange) {
      sql += ` AND (created_at BETWEEN ? AND ? OR updated_at BETWEEN ? AND ?)`;
      const start = state.registers.timeRange.start.toISOString();
      const end = state.registers.timeRange.end.toISOString();
      args.push(start, end, start, end);
    }

    sql += ` LIMIT 100`; // Hard safety limit for fetch

    const rows = db.query(sql).all(...args) as any[];
    state.memory.candidates = rows;
    state.focus.entityIds = rows.map(r => r.id);
    
    state.memory.logs.push(`-> Selected ${rows.length} candidates`);
    return state;
  }

  /**
   * Physics Head: Applies Logic/Gravity to filter memory
   * Equivalent to: Head-wise State Manipulation (Filtering/Decay)
   */
  private async headPhysics(state: PrismState, params: { mode: 'gravity' | 'time'; threshold?: number }): Promise<PrismState> {
    const threshold = params.threshold ?? state.registers.minGravity;

    if (params.mode === 'gravity') {
      // Calculate gravity for each candidate
      const enriched = state.memory.candidates.map(candidate => {
        // Mocking the input format for PhysicsSystem
        const gravityInput: GravityCandidate = {
          id: candidate.id,
          tag: candidate.tag,
          created_at: candidate.created_at,
          last_scouted_at: candidate.last_scouted_at,
          // If we had real physics data joined, we'd use it. For now use defaults.
        };
        
        const { gravity } = calculateEntityGravity(gravityInput);
        return { ...candidate, _g: gravity };
      });

      // Filter and Sort
      state.memory.candidates = enriched
        .filter(c => c._g >= threshold)
        .sort((a, b) => b._g - a._g);
        
      state.memory.logs.push(`-> Filtered by Gravity >= ${threshold}. Remaining: ${state.memory.candidates.length}`);
    }

    // Update focus pointers
    state.focus.entityIds = state.memory.candidates.map(c => c.id);
    return state;
  }

  /**
   * Mutator Head: Writes to the Graph (Permanent Storage)
   * Equivalent to: State Commit
   */
  private async headMutator(state: PrismState, params: { targetId: string; relation: string }): Promise<PrismState> {
    const db = getDB();
    const sources = state.focus.entityIds;
    
    if (sources.length === 0) {
      state.memory.logs.push(`-> [WARN] No focus entities to link.`);
      return state;
    }

    const stmts: string[] = [];
    db.transaction(() => {
      for (const sourceId of sources) {
        // Create relation
        db.query(`
          INSERT INTO graph_relations (source, target, type, weight)
          VALUES (?, ?, ?, 1.0)
          ON CONFLICT(source, target, type) DO NOTHING
        `).run(sourceId, params.targetId, params.relation);
        stmts.push(`${sourceId} -> ${params.targetId}`);
      }
    })();

    state.memory.logs.push(`-> Linked ${sources.length} entities to ${params.targetId}`);
    return state;
  }

  /**
   * Projector Head: Formats output
   * Equivalent to: Linear Projection to Output Logic
   */
  private async headProjector(state: PrismState, params: { fields: string[] }): Promise<PrismState> {
    const limit = state.registers.limit;
    const subset = state.memory.candidates.slice(0, limit);
    
    state.memory.results = subset.map(item => {
      const projection: any = {};
      for (const field of params.fields) {
        projection[field] = item[field];
      }
      // Always include debug score if present
      if (item._g) projection._score = item._g;
      return projection;
    });

    return state;
  }
}

// Singleton export
export const instructionSystem = new InstructionSystem();
