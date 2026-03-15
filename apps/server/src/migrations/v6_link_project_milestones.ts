/**
 * Migration V6: Link Project Milestones
 * 
 * Problem: Milestones from the same project but different memories
 * are not linked to each other.
 * 
 * Solution: For each project, find all related milestones and:
 * 1. Add milestone → milestone relations
 * 2. Add milestone blocks to each milestone's page
 * 
 * Rule: If milestone A and milestone B both relate to project P,
 * then A and B should be related to each other.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from './index.js';

export const v6_link_project_milestones: Migration = {
  version: 6,
  name: 'link_project_milestones',
  description: 'Link milestones that belong to the same project',
  
  up: (db: Database) => {
    console.error('  Finding milestones grouped by project...');
    
    // Find all project → milestone relationships via page_blocks
    // A milestone is related to a project if the project appears on the milestone's page
    const projectMilestones = db.query(`
      SELECT DISTINCT pb.page_id as milestone_id, pb.block_id as project_id
      FROM page_blocks pb
      WHERE pb.page_id LIKE 'milestone:%'
        AND pb.block_id LIKE 'project:%'
    `).all() as { milestone_id: string; project_id: string }[];
    
    // Group milestones by project
    const projectToMilestones = new Map<string, string[]>();
    for (const row of projectMilestones) {
      if (!projectToMilestones.has(row.project_id)) {
        projectToMilestones.set(row.project_id, []);
      }
      projectToMilestones.get(row.project_id)!.push(row.milestone_id);
    }
    
    console.error(`  Found ${projectToMilestones.size} projects with milestones`);
    
    let relationsAdded = 0;
    let blocksAdded = 0;
    
    // Prepared statements
    const checkRelation = db.query(`
      SELECT 1 FROM relations WHERE source = ? AND target = ?
    `);
    const insertRelation = db.query(`
      INSERT INTO relations (source, target, type, weight, evidence)
      VALUES (?, ?, 'sibling', 0.8, 'same_project_milestone')
    `);
    const checkPageBlock = db.query(`
      SELECT 1 FROM page_blocks WHERE page_id = ? AND block_id = ?
    `);
    const getMaxPosition = db.query(`
      SELECT COALESCE(MAX(position), 0) as max_pos FROM page_blocks WHERE page_id = ?
    `);
    const insertPageBlock = db.query(`
      INSERT INTO page_blocks (page_id, block_id, position, target, is_header, is_source, color_override)
      VALUES (?, ?, ?, ?, 0, 0, NULL)
    `);
    
    // For each project, link its milestones to each other
    for (const [projectId, milestones] of projectToMilestones) {
      if (milestones.length < 2) continue;
      
      console.error(`  Project ${projectId}: ${milestones.length} milestones`);
      
      // Create all-pairs relations and page_blocks
      for (let i = 0; i < milestones.length; i++) {
        for (let j = 0; j < milestones.length; j++) {
          if (i === j) continue;
          
          const source = milestones[i];
          const target = milestones[j];
          
          // Add relation if not exists
          if (!checkRelation.get(source, target)) {
            insertRelation.run(source, target);
            relationsAdded++;
          }
          
          // Add page_block if not exists (target milestone appears on source's page)
          if (!checkPageBlock.get(source, target)) {
            const maxPos = (getMaxPosition.get(source) as { max_pos: number }).max_pos;
            insertPageBlock.run(source, target, maxPos + 1, target);
            blocksAdded++;
          }
        }
      }
    }
    
    console.error(`  ✓ Added ${relationsAdded} milestone relations`);
    console.error(`  ✓ Added ${blocksAdded} page blocks`);
    
    // Also add milestones to their project's page
    console.error('  Adding milestones to project pages...');
    
    let projectBlocksAdded = 0;
    for (const [projectId, milestones] of projectToMilestones) {
      for (const milestone of milestones) {
        // Check if milestone is already on project's page
        if (!checkPageBlock.get(projectId, milestone)) {
          const maxPos = (getMaxPosition.get(projectId) as { max_pos: number }).max_pos;
          insertPageBlock.run(projectId, milestone, maxPos + 1, milestone);
          projectBlocksAdded++;
        }
      }
    }
    
    console.error(`  ✓ Added ${projectBlocksAdded} milestones to project pages`);
  },
};




