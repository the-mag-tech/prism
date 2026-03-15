import { describe, expect, test, mock, beforeEach } from "bun:test";

// Mock ai-clients module to return controlled OpenAI mock
const mockOpenAIResponse = {
    choices: [
        {
            message: {
                content: JSON.stringify({
                    // Generic mock response
                    risk: 5,
                    benefit: 5,
                    cost: 5,
                    feasibility: 5,
                    sourceCount: 5,
                    authoritative: 5,
                    dataPoints: 5,
                    crossValidation: 5,
                    characterArc: 5,
                    conflictIntensity: 5,
                    empathy: 5,
                    resonance: 5,
                    mechanism: 5,
                    rootCause: 5,
                    impactChain: 5,
                    evidenceLink: 5,
                    reason: "Mock reason",
                    keyFindings: ["Finding 1"],
                    citations: ["Citation 1"],
                    confidence: 80,
                    protagonist: "Hero",
                    conflict: "Struggle",
                    journey: "Victory",
                    emotionalTheme: "Hope",
                    coreMechanism: "Gears",
                    rootCauses: ["Rust"],
                    consequences: ["Breakdown"],
                    diagramLike: "A->B",
                }),
            },
        },
    ],
};

mock.module("../src/lib/ai-clients.js", () => {
    return {
        getOpenAI: () => ({
            chat: {
                completions: {
                    create: async () => mockOpenAIResponse,
                },
            },
            embeddings: {
                create: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] })
            }
        }),
    };
});

import { EvidenceDepthStrategy } from "../src/lib/agents/explorer/strategies/evidence";
import { EmotionalDepthStrategy } from "../src/lib/agents/explorer/strategies/emotional";
import { CausalDepthStrategy } from "../src/lib/agents/explorer/strategies/causal";
import { IronyDepthStrategy } from "../src/lib/agents/explorer/strategies/irony";

describe("Deep Explorer Strategies", () => {
    const intent = {
        originalQuery: "test query",
        coreObject: "test object",
        context: "test context",
        searchQueries: [],
        depth: "concept_exploration",
    };

    const findings = [
        { title: "Test Title", content: "Test Content", url: "http://test.com", source: "search" },
    ];

    test("EvidenceDepthStrategy should evaluate and format", async () => {
        const strategy = new EvidenceDepthStrategy();
        const score = await strategy.evaluate(findings, intent as any);

        expect(score.level).toBeGreaterThan(0);
        expect(score.reason).toBe("Mock reason");

        const output = await strategy.format(findings, score, intent as any);
        expect(output.type).toBe("evidence");
        expect(output.citations).toContain("Citation 1");
    });

    test("EmotionalDepthStrategy should evaluate and format", async () => {
        const strategy = new EmotionalDepthStrategy();
        const score = await strategy.evaluate(findings, intent as any);

        expect(score.level).toBeGreaterThan(0);

        const output = await strategy.format(findings, score, intent as any);
        expect(output.type).toBe("emotional");
        expect(output.emotionalTheme).toBe("Hope");
    });

    test("CausalDepthStrategy should evaluate and format", async () => {
        const strategy = new CausalDepthStrategy();
        const score = await strategy.evaluate(findings, intent as any);

        expect(score.level).toBeGreaterThan(0);

        const output = await strategy.format(findings, score, intent as any);
        expect(output.type).toBe("causal");
        expect(output.coreMechanism).toBe("Gears");
    });

    test("IronyDepthStrategy should evaluate and format", async () => {
        const strategy = new IronyDepthStrategy();
        // Irony uses different logic for format, might need specific mock if stricter
        // But for basic JSON return it should pass
        const score = await strategy.evaluate(findings, intent as any);
        expect(score.level).toBeGreaterThan(0);
    });
});
