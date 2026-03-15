#!/usr/bin/env npx ts-node

/**
 * Prism Command Line Interface
 * Unified entry point for all Prism tools.
 * 
 * Usage:
 *   npx ts-node src/cli/index.ts <command> [options]
 */

import { DeepExplorer } from '../lib/agents/explorer/engine.js';
import { IronyDepthStrategy } from '../lib/agents/explorer/strategies/irony.js';
import { graphWriter } from '../lib/graph-link/index.js';
import { initDB, closeDB } from '../db.js';

const USAGE = `
Usage: prism <command> [options]

Commands:
  explore <topic>       Deep explore a topic (using Deep Explorer v2)
  ingest <url>          Directly ingest a URL into the graph
  seed                  Run database seeder (wrapper)
  help                  Show this help message

Options:
  --depth=<level>       Max exploration depth (default: 2)
  --width=<width>       Exploration width (default: 3)
  --ingest              Enable finding ingestion (explore command)
`;

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const restArgs = args.slice(1);

    if (!command || command === 'help') {
        console.log(USAGE);
        return;
    }

    // Initialize DB for all commands
    initDB();

    try {
        switch (command) {
            case 'explore':
                await cmdExplore(restArgs);
                break;
            case 'ingest':
                await cmdIngest(restArgs);
                break;
            case 'seed':
                // For seed, we might delegate to the existing script or import it
                console.log('Use "npx ts-node src/cli/seed-db.ts" for now.');
                break;
            default:
                console.error(`Unknown command: ${command}`);
                console.log(USAGE);
                process.exit(1);
        }
    } catch (error) {
        console.error('Command failed:', error);
        process.exit(1);
    } finally {
        closeDB();
    }
}

// =============================================================================
// SUBCOMMANDS
// =============================================================================

async function cmdExplore(args: string[]) {
    const topic = args.find(a => !a.startsWith('--'));
    if (!topic) {
        console.error('Error: Topic required.');
        console.log('Usage: prism explore <topic> [--depth=N] [--width=N] [--ingest]');
        process.exit(1);
    }

    // Parse Options
    const ingest = args.includes('--ingest');
    const multi = args.includes('--multi');
    const depthArg = args.find(a => a.startsWith('--depth='));
    const widthArg = args.find(a => a.startsWith('--width='));

    const targetLevel = depthArg ? parseInt(depthArg.split('=')[1]) : 2;
    const width = widthArg ? parseInt(widthArg.split('=')[1]) : 3;

    // Multi-Anchor Scout Mode
    if (multi) {
        // Dynamic import to avoid circular dep issues if any
        const { ScoutAgent } = await import('../lib/agents/scout/agent.js');
        const scout = new ScoutAgent();

        const entities = topic.split(',').map(name => name.trim());
        console.log(`\n🛸 Multi-Scout Mode: ${entities.length} entities`);
        console.log(`   Targets: ${entities.join(', ')}\n`);

        const scoutEntities = entities.map(name => ({
            name,
            type: 'concept' as any, // Default type
            context: 'CLI Multi-Scout Request',
            searchQuery: `${name} latest info`
        }));

        await scout.scoutMultiple(scoutEntities);
        return;
    }

    // Default: Deep Explorer
    const engine = new DeepExplorer();

    // Configure Strategy
    // Configure Strategy
    const strategyArg = args.find(a => a.startsWith('--strategy='));

    if (!strategyArg) {
        // Auto Mode (Prism Splitter)
        console.log(`\n🔮 Prism Explorer v2 (Auto Mode)`);
        console.log(`   Topic: "${topic}"`);
        console.log(`   Analyst: Prism Splitter (Detecting Blind Spot...)`);

        await engine.exploreAuto(topic);
        return;
    }

    const strategyName = strategyArg.split('=')[1];
    let strategy;

    switch (strategyName) {
        case 'evidence':
            const { EvidenceDepthStrategy } = await import('../lib/agents/explorer/strategies/evidence.js');
            strategy = new EvidenceDepthStrategy();
            break;
        case 'emotional':
            const { EmotionalDepthStrategy } = await import('../lib/agents/explorer/strategies/emotional.js');
            strategy = new EmotionalDepthStrategy();
            break;
        case 'causal':
            const { CausalDepthStrategy } = await import('../lib/agents/explorer/strategies/causal.js');
            strategy = new CausalDepthStrategy();
            break;
        case 'irony':
        default:
            strategy = new IronyDepthStrategy();
            break;
    }

    console.log(`\n🔮 Prism Explorer v2`);
    console.log(`   Topic: "${topic}"`);
    console.log(`   Strategy: ${strategy.name}`);
    console.log(`   Depth: ${targetLevel}, Width: ${width}`);
    console.log(`   Ingest: ${ingest ? 'Enabled' : 'Disabled'}\n`);

    await engine.explore(topic, {
        strategy,
        config: { targetLevel, width, maxRounds: 10 },
        ingest
    });
}

// Helper for file ingestion
import fs from 'fs/promises';
import path from 'path';

async function cmdIngest(args: string[]) {
    if (args.length === 0) {
        console.error('Error: File path or URL required.');
        process.exit(1);
    }

    const targets = args;
    console.log(`\n📥 Ingesting ${targets.length} targets...`);

    for (const target of targets) {
        try {
            // Handle file:// URLs
            if (target.startsWith('file://')) {
                const filePath = new URL(target).pathname;
                const stat = await fs.stat(filePath).catch(() => null);
                if (stat && stat.isFile()) {
                    await ingestFile(filePath);
                } else if (stat && stat.isDirectory()) {
                    const files = await fs.readdir(filePath, { recursive: true });
                    const mdFiles = files.filter((f: any) => typeof f === 'string' && f.endsWith('.md')) as string[];
                    console.log(`   📂 Directory detected: ${filePath} (${mdFiles.length} markdown files)`);
                    for (const file of mdFiles) {
                        const fullPath = path.join(filePath, file);
                        await ingestFile(fullPath);
                    }
                } else {
                    console.error(`   ❌ File not found: ${filePath}`);
                }
                continue;
            }

            // Basic file/dir check
            const stat = await fs.stat(target).catch(() => null);

            if (stat && stat.isDirectory()) {
                const files = await fs.readdir(target, { recursive: true });
                const mdFiles = files.filter((f: any) => typeof f === 'string' && f.endsWith('.md')) as string[];
                console.log(`   📂 Directory detected: ${target} (${mdFiles.length} markdown files)`);

                for (const file of mdFiles) {
                    const fullPath = path.join(target, file);
                    await ingestFile(fullPath);
                }
            } else if (stat && stat.isFile()) {
                await ingestFile(target);
            } else {
                // Assume URL - fetch and ingest
                await ingestUrl(target);
            }

        } catch (e) {
            console.error(`   ❌ Failed to ingest ${target}:`, e);
        }
    }
}

async function ingestFile(filePath: string) {
    console.log(`   📄 Reading ${filePath}...`);
    const content = await fs.readFile(filePath, 'utf-8');
    const filename = path.basename(filePath);

    // Simple title extraction (first # header or filename)
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : filename;

    const id = await graphWriter.ingestFinding(path.resolve(filePath), title, content, []);
    console.log(`      ✅ Ingested. Memory ID: ${id}`);
}

async function ingestUrl(url: string) {
    console.log(`   🌐 Fetching ${url}...`);

    // Use Scout's snapshotUrl for content extraction
    const { snapshotUrl } = await import('../lib/agents/scout/snapshot.js');
    const snapshot = await snapshotUrl(url);

    if (!snapshot || !snapshot.content) {
        console.error(`   ❌ Failed to fetch content from: ${url}`);
        return;
    }

    const title = snapshot.title || new URL(url).hostname;
    const htmlContent = snapshot.content;
    const textContent = snapshot.textContent || '';

    console.log(`   📝 Title: "${title}" (${htmlContent.length} chars HTML, ${textContent.length} chars text)`);

    const id = await graphWriter.ingestFinding(url, title, htmlContent, [], textContent);
    console.log(`      ✅ Ingested. Memory ID: ${id}`);
}

main().catch(console.error);
