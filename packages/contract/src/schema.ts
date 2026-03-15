/**
 * Prism Contract - Runtime Validation (Lightweight)
 * 
 * Simple runtime validation without external dependencies.
 * Can be upgraded to Zod when disk space is available.
 */

import type { PrismBlock, PrismPage, PrismRelation, RelationType } from './types.js';

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

const VALID_RELATION_TYPES: RelationType[] = [
  'participant',
  'mentioned',
  'about',
  'followup',
  'related',
  'co-occurred'
];

/**
 * Validates entity ID format
 */
export function validateEntityId(id: string): { valid: boolean; error?: string } {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'ID must be a non-empty string' };
  }
  
  const pattern = /^[a-z]+:[a-z0-9-]+$/;
  if (!pattern.test(id)) {
    return { 
      valid: false, 
      error: `ID "${id}" must be in format "category:slug" (lowercase, alphanumeric with hyphens)` 
    };
  }
  
  return { valid: true };
}

/**
 * Validates a PrismBlock
 */
export function validateBlock(block: unknown): { valid: boolean; error?: string; data?: PrismBlock } {
  if (!block || typeof block !== 'object') {
    return { valid: false, error: 'Block must be an object' };
  }
  
  const b = block as Record<string, unknown>;
  
  // Required: id
  const idValidation = validateEntityId(b.id as string);
  if (!idValidation.valid) {
    return { valid: false, error: `Block ID: ${idValidation.error}` };
  }
  
  // Required: title
  if (!b.title || typeof b.title !== 'string') {
    return { valid: false, error: 'Block must have a non-empty title string' };
  }
  
  // Optional fields type check
  if (b.subtitle !== undefined && typeof b.subtitle !== 'string') {
    return { valid: false, error: 'Block subtitle must be a string' };
  }
  if (b.body !== undefined && typeof b.body !== 'string') {
    return { valid: false, error: 'Block body must be a string' };
  }
  if (b.target !== undefined) {
    const targetValidation = validateEntityId(b.target as string);
    if (!targetValidation.valid) {
      return { valid: false, error: `Block target: ${targetValidation.error}` };
    }
  }
  if (b.isPublic !== undefined && typeof b.isPublic !== 'boolean') {
    return { valid: false, error: 'Block isPublic must be a boolean' };
  }
  if (b.publicSource !== undefined && typeof b.publicSource !== 'string') {
    return { valid: false, error: 'Block publicSource must be a string' };
  }
  if (b.publicUrl !== undefined && typeof b.publicUrl !== 'string') {
    return { valid: false, error: 'Block publicUrl must be a string' };
  }
  if (b.publicTime !== undefined && typeof b.publicTime !== 'string') {
    return { valid: false, error: 'Block publicTime must be a string' };
  }
  
  return { 
    valid: true, 
    data: {
      id: b.id as string,
      title: b.title as string,
      subtitle: b.subtitle as string | undefined,
      body: b.body as string | undefined,
      target: b.target as string | undefined,
      action: b.action as string | undefined,
      tag: b.tag as string | undefined,
      isPublic: b.isPublic as boolean | undefined,
      publicSource: b.publicSource as string | undefined,
      publicUrl: b.publicUrl as string | undefined,
      publicTime: b.publicTime as string | undefined,
    }
  };
}

/**
 * Validates a PrismRelation
 */
export function validateRelation(relation: unknown): { valid: boolean; error?: string; data?: PrismRelation } {
  if (!relation || typeof relation !== 'object') {
    return { valid: false, error: 'Relation must be an object' };
  }
  
  const r = relation as Record<string, unknown>;
  
  // Required: source
  const sourceValidation = validateEntityId(r.source as string);
  if (!sourceValidation.valid) {
    return { valid: false, error: `Relation source: ${sourceValidation.error}` };
  }
  
  // Required: target
  const targetValidation = validateEntityId(r.target as string);
  if (!targetValidation.valid) {
    return { valid: false, error: `Relation target: ${targetValidation.error}` };
  }
  
  // Required: type
  if (!VALID_RELATION_TYPES.includes(r.type as RelationType)) {
    return { valid: false, error: `Relation type must be one of: ${VALID_RELATION_TYPES.join(', ')}` };
  }
  
  // Optional: weight
  if (r.weight !== undefined) {
    if (typeof r.weight !== 'number' || r.weight < 0 || r.weight > 1) {
      return { valid: false, error: 'Relation weight must be a number between 0 and 1' };
    }
  }
  
  return {
    valid: true,
    data: {
      source: r.source as string,
      target: r.target as string,
      type: r.type as RelationType,
      weight: r.weight as number | undefined,
      evidence: r.evidence as string | undefined,
    }
  };
}

/**
 * Validates a PrismPage
 */
export function validatePage(page: unknown): { valid: boolean; error?: string; data?: PrismPage } {
  if (!page || typeof page !== 'object') {
    return { valid: false, error: 'Page must be an object' };
  }
  
  const p = page as Record<string, unknown>;
  
  // Required: id
  const idValidation = validateEntityId(p.id as string);
  if (!idValidation.valid) {
    return { valid: false, error: `Page ID: ${idValidation.error}` };
  }
  
  // Required: blocks (non-empty array)
  if (!Array.isArray(p.blocks) || p.blocks.length === 0) {
    return { valid: false, error: 'Page must have at least one block' };
  }
  
  const validatedBlocks: PrismBlock[] = [];
  for (let i = 0; i < p.blocks.length; i++) {
    const blockValidation = validateBlock(p.blocks[i]);
    if (!blockValidation.valid) {
      return { valid: false, error: `Block ${i}: ${blockValidation.error}` };
    }
    validatedBlocks.push(blockValidation.data!);
  }
  
  // Optional: relations
  const validatedRelations: PrismRelation[] = [];
  if (p.relations !== undefined) {
    if (!Array.isArray(p.relations)) {
      return { valid: false, error: 'Page relations must be an array' };
    }
    for (let i = 0; i < p.relations.length; i++) {
      const relationValidation = validateRelation(p.relations[i]);
      if (!relationValidation.valid) {
        return { valid: false, error: `Relation ${i}: ${relationValidation.error}` };
      }
      validatedRelations.push(relationValidation.data!);
    }
  }
  
  return {
    valid: true,
    data: {
      id: p.id as string,
      blocks: validatedBlocks,
      relations: validatedRelations.length > 0 ? validatedRelations : undefined,
    }
  };
}
