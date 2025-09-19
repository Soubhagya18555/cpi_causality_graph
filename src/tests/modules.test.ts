import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PublicKey } from "@solana/web3.js";
import { buildCausalityGraph } from "../causality_builder.js";
import { analyzeRisk } from "../risk_analyzer.js";
import { exportDot, exportDotSubgraph } from "../dot_exporter.js";
import { findAllPaths, findLongestPath, findPathsThroughProgram, summarizePaths } from "../path_finder.js";
import {
  decodeInstruction,
  decodeGraphInstructions,
  summarizeInstructions,
} from "../instruction_decoder.js";
import { buildTimeline, formatTimelineText, findTokenOperations } from "../timeline.js";
import type { CpiTreeNode } from "../graph_types.js";

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function key(base58: string): PublicKey {
  return new PublicKey(base58);
}

function makeSampleGraph() {
  const accountKeys = [key(SYSTEM), key(TOKEN), key(MEMO)];
  const tree: CpiTreeNode[] = [
    {
      programId: SYSTEM,
      instructionIndex: 0,
      innerIndex: null,
      stackHeight: 1,
      kind: "top_level",
      data: Buffer.from([2, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0]),
      accountIndices: [1],
      children: [
        {
          programId: TOKEN,
          instructionIndex: 0,
          innerIndex: 0,
          stackHeight: 2,
          kind: "cpi",
          data: Buffer.from([3, 50, 0, 0, 0, 0, 0, 0, 0]),
          accountIndices: [2],
          children: [
            {
              programId: MEMO,
              instructionIndex: 0,
              innerIndex: 1,
              stackHeight: 3,
              kind: "cpi",
              data: Buffer.from("test memo"),
              accountIndices: [],
              children: [],
            },
          ],
        },
      ],
    },
  ];

  return buildCausalityGraph("timeline_sig", 200, 1_700_000_000, accountKeys, tree, true);
}

describe("dot_exporter", () => {
  it("exports valid DOT format", () => {
    const graph = makeSampleGraph();
    const risk = analyzeRisk(graph);
    const dot = exportDot(graph, risk, { rankdir: "LR" });
    assert.ok(dot.startsWith("digraph cpi_causality"));
    assert.ok(dot.includes('"ix_0"'));
    assert.ok(dot.includes("->"));
    assert.ok(dot.endsWith("}\n"));
  });

  it("exports subgraph for selected nodes", () => {
    const graph = makeSampleGraph();
    const nodeIds = new Set([graph.nodes[0]!.id, graph.nodes[1]!.id]);
    const dot = exportDotSubgraph(graph, nodeIds);
    assert.ok(dot.includes(graph.nodes[0]!.id));
    assert.ok(!dot.includes(graph.nodes[2]?.id ?? "missing_third"));
  });
});

describe("path_finder", () => {
  it("finds paths from top level node", () => {
    const graph = makeSampleGraph();
    const topNode = graph.nodes.find((n) => n.kind === "top_level")!;
    const paths = findAllPaths(graph, topNode.id, { maxDepth: 5 });
    assert.ok(paths.length >= 1);
    assert.ok(paths.some((p) => p.programSequence.includes(TOKEN)));
  });

  it("finds longest path and paths through program", () => {
    const graph = makeSampleGraph();
    const longest = findLongestPath(graph);
    assert.ok(longest);
    assert.ok(longest!.depth >= 2);

    const tokenPaths = findPathsThroughProgram(graph, TOKEN);
    assert.ok(tokenPaths.length >= 1);

    const summary = summarizePaths(tokenPaths);
    assert.ok(summary.uniquePrograms.includes(TOKEN));
  });
});

describe("instruction_decoder", () => {
  it("decodes system transfer instruction", () => {
    const data = Buffer.alloc(12);
    data[0] = 2;
    data.writeBigUInt64LE(1_000_000n, 4);
    const decoded = decodeInstruction(SYSTEM, data.toString("hex"), ["a", "b"]);
    assert.equal(decoded.category, "system_transfer");
    assert.ok(decoded.summary.includes("1000000"));
  });

  it("decodes token transfer instruction", () => {
    const data = Buffer.alloc(9);
    data[0] = 3;
    data.writeBigUInt64LE(500n, 1);
    const decoded = decodeInstruction(TOKEN, data.toString("hex"), ["a", "b", "c"]);
    assert.equal(decoded.category, "token_transfer");
    assert.ok(decoded.summary.includes("500"));
  });

  it("summarizes decoded graph instructions", () => {
    const graph = makeSampleGraph();
    const decoded = decodeGraphInstructions(graph.nodes);
    const summary = summarizeInstructions(decoded);
    assert.ok(summary.size >= 1);
  });
});

describe("timeline", () => {
  it("builds ordered timeline with decoded events", () => {
    const graph = makeSampleGraph();
    const timeline = buildTimeline(graph);
    assert.equal(timeline.totalInvocations, 3);
    assert.equal(timeline.maxStackHeight, 3);
    assert.equal(timeline.events[0]?.kind, "top_level");
    assert.ok(timeline.events[1]?.decoded.category === "token_transfer");
  });

  it("formats timeline text and finds token operations", () => {
    const graph = makeSampleGraph();
    const timeline = buildTimeline(graph);
    const text = formatTimelineText(timeline);
    assert.ok(text.includes("CPI Timeline"));
    assert.ok(text.includes("token"));

    const tokenOps = findTokenOperations(timeline);
    assert.ok(tokenOps.length >= 1);
  });
});
