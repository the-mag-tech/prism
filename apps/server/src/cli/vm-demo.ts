
import { instructionSystem, Instruction } from '../systems/InstructionSystem.js';
import { getDB } from '../db.js';

async function main() {
  console.log("🤖 Prism NL-VM Demo");
  console.log("===================");
  console.log("Natural Language Goal: 'Find important recent tech entities and link them to project:rwkv_research'");

  // 1. Compile NL to OpCodes (Simulated)
  const program: Instruction[] = [
    // Step 1: Set Context - Only look at things from the last 30 days
    {
      op: 'SET_REGISTER',
      params: {
        timeRange: {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          end: new Date()
        },
        minGravity: 0.5, // We only want "sticky" concepts
        limit: 5
      }
    },
    
    // Step 2: Select - Broad search for "model" or "ai"
    {
      op: 'SELECT',
      params: {
        query: 'ai', // Simulating a broad search
      }
    },

    // Step 3: Filter - Apply Physics (Gravity) to find what's actually important
    // This uses the PhysicsHead to calculate weights dynamically
    {
      op: 'FILTER',
      params: {
        mode: 'gravity',
        threshold: 0.6
      }
    },

    // Step 4: Project - Show us what we found
    {
      op: 'PROJECT',
      params: {
        fields: ['id', 'title', 'tag']
      }
    },

    // Step 5: Link - Connect these findings to our research project
    // (Commented out to be safe in demo, but this is the Write Head)
    // {
    //   op: 'LINK',
    //   params: {
    //     targetId: 'project:rwkv_research',
    //     relation: 'relevant_to'
    //   }
    // }
  ];

  console.log("\n📜 Compiled Program:");
  console.log(JSON.stringify(program, null, 2));

  // 2. Execute
  console.log("\n🚀 Executing VM...");
  const finalState = await instructionSystem.execute(program);

  // 3. Inspect State
  console.log("\n🧠 Final Memory State:");
  console.table(finalState.memory.results);

  console.log("\n📝 Execution Trace (Chain of Thought):");
  finalState.memory.logs.forEach(log => console.log(log));
}

// Run if main
if (require.main === module) {
  main().catch(console.error);
}
