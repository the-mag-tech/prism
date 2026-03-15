/**
 * Ripple Module
 * 
 * The Ripple System propagates knowledge through the graph:
 * - Uses Serendipity (graph-based surprise) to filter content
 * - Profiles entities via triangulated search
 * - Onboards high-value content to trigger entity extraction
 * 
 * Architecture:
 * - RippleAgent: Core logic (profile, onboard, propagate) - lives here
 * - RippleSystem: Event-driven orchestration - lives in src/systems/RippleSystem.ts
 * - Types: Shared type definitions - lives here
 * 
 * Note: RippleSystem was migrated to src/systems/ for consistency with
 * ScoutSystem and PhysicsSystem. Import it from '../systems/RippleSystem.js'.
 */

export { RippleAgent, rippleAgent } from './agent.js';
export * from './types.js';

// Re-export from systems/ for backwards compatibility
export { RippleSystem, rippleSystem } from '../../../systems/RippleSystem.js';







