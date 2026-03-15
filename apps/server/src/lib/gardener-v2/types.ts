/**
 * Gardener V2 - Relationship Maintenance Types
 * 
 * The TRUE Gardener: "Who might need my attention?"
 * 
 * This module is for relationship tending, NOT deduplication.
 * Deduplication is handled by the Curator module.
 * 
 * @see TRIBE-STYLES.md for the Gardener persona:
 * - Values authentic human connection
 * - Cares about people, not transactions
 * - Sees relationships as gardens that need tending
 * 
 * STATUS: Stub/Interface only. Implementation pending.
 */

// =============================================================================
// CARE SIGNAL TYPES
// =============================================================================

/**
 * A signal that a relationship might need attention.
 */
export interface CareSignal {
  /** Type of care signal */
  type: 'dormant' | 'milestone' | 'opportunity' | 'check_in';
  
  /** The person entity this signal is about */
  personId: string;
  
  /** Human-readable message */
  message: string;
  
  /** How urgent is this signal? */
  urgency: 'low' | 'medium' | 'high';
  
  /** Optional context from previous interactions */
  context?: string;
  
  /** Suggested action (invitation, not command) */
  suggestedAction?: string;
  
  /** When this signal was generated */
  generatedAt: Date;
}

/**
 * Dormant relationship signal.
 * "You haven't connected with X in Y days."
 */
export interface DormantSignal extends CareSignal {
  type: 'dormant';
  daysSinceLastContact: number;
  lastInteractionSummary?: string;
}

/**
 * Milestone signal (birthday, anniversary, etc.).
 * "Tomorrow is X's birthday."
 */
export interface MilestoneSignal extends CareSignal {
  type: 'milestone';
  milestoneType: 'birthday' | 'anniversary' | 'work_anniversary' | 'custom';
  milestoneDate: Date;
  daysUntil: number;
}

/**
 * Opportunity signal (life event, funding, etc.).
 * "X's company just announced Series B."
 */
export interface OpportunitySignal extends CareSignal {
  type: 'opportunity';
  opportunityType: 'funding' | 'promotion' | 'launch' | 'achievement' | 'custom';
  sourceUrl?: string;
}

// =============================================================================
// RELATIONSHIP HEALTH TYPES
// =============================================================================

/**
 * Health score for a relationship.
 */
export interface RelationshipHealth {
  personId: string;
  personName: string;
  
  /** Overall health score (0-1) */
  healthScore: number;
  
  /** Days since last meaningful interaction */
  daysSinceContact: number;
  
  /** Last interaction timestamp */
  lastInteractionAt?: Date;
  
  /** Type of last interaction */
  lastInteractionType?: 'email' | 'meeting' | 'call' | 'message' | 'other';
  
  /** Relationship tier (close friend, colleague, acquaintance) */
  tier?: 'inner_circle' | 'close' | 'regular' | 'acquaintance';
  
  /** Tags for filtering */
  tags?: string[];
}

// =============================================================================
// GARDENER REPORT TYPES
// =============================================================================

/**
 * Report from a Gardener scan cycle.
 */
export interface GardenerV2Report {
  /** Signals generated in this cycle */
  signals: CareSignal[];
  
  /** Relationships scanned */
  relationshipsScanned: number;
  
  /** Relationships needing attention */
  needingAttention: number;
  
  /** Upcoming milestones in next 7 days */
  upcomingMilestones: number;
  
  /** Timestamp */
  timestamp: Date;
}

// =============================================================================
// PERSON METADATA TYPES
// =============================================================================

/**
 * Extended metadata for a person entity.
 * These fields enable Gardener functionality.
 */
export interface PersonMetadata {
  /** Birthday (YYYY-MM-DD or MM-DD for recurring) */
  birthday?: string;
  
  /** Work anniversary */
  workAnniversary?: string;
  
  /** Custom milestones */
  milestones?: Array<{
    name: string;
    date: string;
    recurring: boolean;
  }>;
  
  /** Preferred contact frequency (days) */
  preferredContactFrequency?: number;
  
  /** Relationship tier */
  tier?: 'inner_circle' | 'close' | 'regular' | 'acquaintance';
  
  /** Notes about this person */
  notes?: string[];
  
  /** Topics they're interested in (for conversation starters) */
  interests?: string[];
}





