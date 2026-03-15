/**
 * Prism MCP Tools 统一注册
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { executeGetContext, getContextToolDef } from './get-context.js';
import { executeScout, scoutToolDef } from './scout.js';
import { executeRecall, recallToolDef } from './recall.js';
import { executeGravityTop, gravityTopToolDef } from './gravity-top.js';
import { executeIngest, ingestToolDef } from './ingest.js';
import { executeScoutTick, scoutTickToolDef } from './scout-tick.js';
import { executeExplore, exploreToolDef } from './explore.js';
import { executeSearch, searchToolDef } from './search.js';

// DEV-only tools
import { DEV_MODE } from '../../config.js';
import { executeNarrate, narrateToolDef } from './narrate.js';

export function registerToolHandlers(server: Server) {
    // List all available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        // Base tools (always available)
        const tools = [
            getContextToolDef,
            scoutToolDef,
            scoutTickToolDef,
            recallToolDef,
            gravityTopToolDef,
            ingestToolDef,
            exploreToolDef,
            searchToolDef,
        ];
        
        // DEV-only tools (experimental features)
        if (DEV_MODE) {
            tools.push(narrateToolDef);
        }
        
        return { tools };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        try {
            if (!args) {
                throw new Error('Missing arguments');
            }

            let result: any;

            switch (name) {
                case 'prism_get_context':
                    result = await executeGetContext(args);
                    break;

                case 'prism_scout':
                    result = await executeScout(args);
                    break;

                case 'prism_recall':
                    result = await executeRecall(args);
                    break;

                case 'prism_gravity_top':
                    result = await executeGravityTop(args);
                    break;

                case 'prism_ingest':
                    result = await executeIngest(args);
                    break;

                case 'prism_scout_tick':
                    result = await executeScoutTick(args);
                    break;

                case 'prism_explore':
                    result = await executeExplore(args);
                    break;

                case 'prism_search':
                    result = await executeSearch(args);
                    break;

                // DEV-only tools
                case 'prism_narrate':
                    if (!DEV_MODE) {
                        throw new Error(`Tool ${name} is only available in DEV_MODE`);
                    }
                    result = await executeNarrate(args);
                    break;

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            error: errorMessage,
                            tool: name,
                            arguments: args || {},
                        }, null, 2),
                    },
                ],
                isError: true,
            };
        }
    });
}
