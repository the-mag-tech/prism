import { ScoutAgent } from '../lib/agents/scout/agent.js';
import { initDB } from '../db.js';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

async function main() {
  const args = process.argv.slice(2);
  
  // Parse args
  const profileIndex = args.indexOf('--profile');
  const contextIndex = args.indexOf('--context');
  const discoverIndex = args.indexOf('--discover');
  const intentIndex = args.indexOf('--intent');
  const onboardIndex = args.indexOf('--onboard');
  
  const isProfileMode = profileIndex !== -1;
  const isDiscoverMode = discoverIndex !== -1;
  const isOnboardMode = onboardIndex !== -1;

  // Init DB
  initDB(config.dbPath);
  const agent = new ScoutAgent();

  // =========================================
  // MODE 0: DISCOVERY MODE (Serendipity)
  // =========================================
  if (isDiscoverMode) {
    const filePath = args[discoverIndex + 1];
    if (!filePath) {
      console.error("❌ Error: Please provide a file path after --discover");
      return;
    }

    const intent = intentIndex !== -1 ? args[intentIndex + 1] : undefined;

    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ Error: File not found at ${fullPath}`);
      return;
    }

    console.log(`\n🔍 DISCOVERY MODE ACTIVATED`);
    console.log(`Analyzing: ${path.basename(fullPath)}`);
    if (intent) console.log(`Intent:    "${intent}"`);
    console.log(`----------------------------------------`);

    const content = fs.readFileSync(fullPath, 'utf-8');
    const insight = await agent.discover(content, intent);

    if (insight) {
      console.log(`\n💡 INSIGHT FOUND: [${insight.type}] ${insight.name}`);
      console.log(`   Reason: ${insight.reason}`);
      console.log(`\n   (Tip: To onboard and trigger ripple, run: npm run scout -- --onboard "${insight.name}" --context "Derived from ${path.basename(fullPath)}")\n`);
    } else {
      console.log(`\n🤷 No specific hidden anchor found in this document matching your intent.`);
    }
    return;
  }

  // =========================================
  // MODE 1: PROFILE & ONBOARD MODE (The Ripple)
  // =========================================
  if (isProfileMode || isOnboardMode) {
    const entityName = isProfileMode ? args[profileIndex + 1] : args[onboardIndex + 1];
    if (!entityName) {
      console.error("❌ Error: Please provide an entity name.");
      return;
    }
    
    const context = contextIndex !== -1 ? args[contextIndex + 1] : "General Tech Context";
    
    console.log(`\n👤 PROFILER ACTIVATED`);
    console.log(`Target:  ${entityName}`);
    console.log(`Context: ${context}`);
    if (isOnboardMode) console.log(`Mode:    ONBOARDING (Will trigger Ripple Effect)`);
    console.log(`----------------------------------------`);
    
    const profile = await agent.profile(entityName, context);
    
    console.log(`\n✅ PROFILE SYNTHESIZED:\n`);
    console.log(`Name: ${profile.name}`);
    console.log(`Role: ${profile.role}`);
    console.log(`Bio:  ${profile.bio}`);
    console.log(`Tags: [${profile.tags.join(', ')}]`);
    
    if (profile.assets && profile.assets.length > 0) {
      console.log(`\n🎨 CREATIVE ASSETS GENERATED:`);
      profile.assets.forEach(asset => console.log(`   - ${asset}`));
    }
    
    // If ONBOARD mode, trigger the Ripple Effect
    if (isOnboardMode) {
      console.log(`\n🌊 TRIGGERING RIPPLE EFFECT...`);
      await agent.onboard(profile);
    } else {
      if (profile.relatedEntities.length > 0) {
        console.log(`\n🤝 Implicit Connections (Dry Run):`);
        profile.relatedEntities.forEach(e => {
          console.log(`   - [${e.type}] ${e.name} (${e.reason})`);
        });
      }
      console.log(`\n   (Tip: Run with --onboard to ingest content and grounded connections)`);
    }
    
    console.log(`\n----------------------------------------`);
    return;
  }

  // =========================================
  // MODE 2: STANDARD SCOUT MODE (Existing)
  // =========================================
  const input = args.join(' ');

  if (!input) {
    console.log('Usage:');
    console.log('  1. Standard:  pnpm scout "I saw a tweet by Julian..."');
    console.log('  2. Discover:  pnpm scout -- --discover path/to/doc.md [--intent "..."]');
    console.log('  3. Onboard:   pnpm scout -- --onboard "Julian Benner" --context "Generative UI"');
    return;
  }

  console.log(`\n🕵️  Scouting: "${input}"\n`);

  // 1. Extract
  process.stdout.write('1️⃣  Extracting entities... ');
  const entities = await agent.extract(input);
  console.log(`Found ${entities.length}`);
  entities.forEach(e => console.log(`   - [${e.type}] ${e.name} ("${e.searchQuery}")`));

  // 2. Scout & Snapshot
  console.log('\n2️⃣  Scouting & Snapshotting...');
  const results = [];
  for (const entity of entities) {
    const result = await agent.scout(entity);
    results.push(result);
    if (result.confidence > 0) {
      console.log(`   ✅ Grounded: ${result.originalEntity.name} -> Memory #${result.foundMemoryId}`);
      console.log(`      Title: ${result.summary?.substring(0, 50)}...`);
    } else {
      console.log(`   ❌ Could not ground: ${result.originalEntity.name} (No URL found and Search API missing)`);
    }
  }

  // 3. Ground
  console.log('\n3️⃣  Grounding Text...');
  const groundedText = await agent.ground(input, results);
  
  console.log('\n=== RESULT ===\n');
  console.log(groundedText);
  console.log('\n==============\n');
}

main().catch(console.error);
