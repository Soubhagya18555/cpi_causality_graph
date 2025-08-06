import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PublicKey } from "@solana/web3.js";
import { resolveAccountKeys } from "../alt_resolver.js";
import {
  adjacencyList,
  buildCausalityGraph,
  detectReentrancyCycles,
  graphMaxDepth,
  uniqueProgramIds,
} from "../causality_builder.js";
import {
  CompiledInstructionLike,
  extractCpiTree,
  flattenCpiTree,
  maxStackDepth,
} from "../cpi_extractor.js";
import { exportGraphMl, exportJson } from "../exporter.js";
import { analyzeRisk, KNOWN_PROGRAMS } from "../risk_analyzer.js";
import { CpiTreeNode } from "../graph_types.js";

const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const UNKNOWN_A = "So11111111111111111111111111111111111111112";
const UNKNOWN_B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function key(base58: string): PublicKey {
  return new PublicKey(base58);
}

function makeAccountKeys(...addresses: string[]): PublicKey[] {
  return addresses.map(key);
}

function encodeData(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

describe("alt_resolver", () => {
  it("resolves legacy message account keys without loaded addresses", () => {
    const accountKeys = makeAccountKeys(SYSTEM, TOKEN, MEMO);
    const message = {
      version: "legacy" as const,
      accountKeys,
      compiledInstructions: [],
    };

    const resolved = resolveAccountKeys(message as never, null);
    assert.equal(resolved.fullKeys.length, 3);
    assert.equal(resolved.loadedWritable.length, 0);
    assert.equal(resolved.fullKeys[0]?.toBase58(), SYSTEM);
  });

  it("appends loaded writable and readonly keys for versioned messages", () => {
    const staticKeys = makeAccountKeys(SYSTEM, TOKEN);
    const writable = makeAccountKeys(MEMO);
    const readonly = makeAccountKeys(UNKNOWN_A);

    const message = {
      version: 0 as const,
      staticAccountKeys: staticKeys,
      compiledInstructions: [],
      addressTableLookups: [],
    };

    const resolved = resolveAccountKeys(message as never, {
      writable,
      readonly,
    });

    assert.equal(resolved.fullKeys.length, 4);
    assert.equal(resolved.fullKeys[2]?.toBase58(), MEMO);
    assert.equal(resolved.fullKeys[3]?.toBase58(), UNKNOWN_A);
  });
});

describe("cpi_extractor", () => {
  it("builds nested CPI tree from inner instructions with stack heights", () => {
    const accountKeys = makeAccountKeys(SYSTEM, TOKEN, MEMO, UNKNOWN_A);

    const topLevel: CompiledInstructionLike[] = [
      {
        programIdIndex: 0,
        accounts: [1],
        data: encodeData("0100"),
      },
    ];

    const tree = extractCpiTree(accountKeys, topLevel, {
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              programIdIndex: 1,
              accounts: [2],
              data: encodeData("0200"),
              stackHeight: 2,
            },
            {
              programIdIndex: 2,
              accounts: [3],
              data: encodeData("0300"),
              stackHeight: 3,
            },
            {
              programIdIndex: 1,
              accounts: [2],
              data: encodeData("0400"),
              stackHeight: 2,
            },
          ],
        },
      ],
    });

    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.programId, SYSTEM);
    assert.equal(tree[0]?.children.length, 2);

    const firstCpi = tree[0]?.children[0];
    assert.equal(firstCpi?.programId, TOKEN);
    assert.equal(firstCpi?.children.length, 1);
    assert.equal(firstCpi?.children[0]?.programId, MEMO);
    assert.equal(firstCpi?.children[0]?.stackHeight, 3);

    const secondCpi = tree[0]?.children[1];
    assert.equal(secondCpi?.programId, TOKEN);
    assert.equal(secondCpi?.stackHeight, 2);

    assert.equal(maxStackDepth(tree), 3);
    assert.equal(flattenCpiTree(tree).length, 4);
  });
});

describe("causality_builder", () => {
  it("produces directed edges from caller to callee", () => {
    const accountKeys = makeAccountKeys(SYSTEM, TOKEN, MEMO);

    const tree: CpiTreeNode[] = [
      {
        programId: SYSTEM,
        instructionIndex: 0,
        innerIndex: null,
        stackHeight: 1,
        kind: "top_level",
        data: Buffer.from([1]),
        accountIndices: [1],
        children: [
          {
            programId: TOKEN,
            instructionIndex: 0,
            innerIndex: 0,
            stackHeight: 2,
            kind: "cpi",
            data: Buffer.from([2]),
            accountIndices: [2],
            children: [
              {
                programId: MEMO,
                instructionIndex: 0,
                innerIndex: 1,
                stackHeight: 3,
                kind: "cpi",
                data: Buffer.from([3]),
                accountIndices: [],
                children: [],
              },
            ],
          },
        ],
      },
    ];

    const graph = buildCausalityGraph(
      "test_signature",
      100,
      1_700_000_000,
      accountKeys,
      tree,
      true,
    );

    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);
    assert.equal(graph.edges[0]?.from, "ix_0");
    assert.equal(graph.edges[0]?.to, "ix_0_inner_0_h2");
    assert.equal(graph.edges[1]?.from, "ix_0_inner_0_h2");
    assert.equal(graph.edges[1]?.to, "ix_0_inner_1_h3");
    assert.equal(graphMaxDepth(graph), 3);
    assert.deepEqual(uniqueProgramIds(graph), [SYSTEM, MEMO, TOKEN]);
  });

  it("detects reentrancy cycles in adjacency graph", () => {
    const graph = buildCausalityGraph(
      "cycle_sig",
      1,
      null,
      makeAccountKeys(SYSTEM, TOKEN),
      [],
      false,
    );

    graph.nodes.push(
      {
        id: "a",
        programId: SYSTEM,
        instructionIndex: 0,
        innerIndex: null,
        stackHeight: 1,
        kind: "top_level",
        dataHex: "01",
        accountKeys: [],
      },
      {
        id: "b",
        programId: TOKEN,
        instructionIndex: 0,
        innerIndex: 0,
        stackHeight: 2,
        kind: "cpi",
        dataHex: "02",
        accountKeys: [],
      },
      {
        id: "c",
        programId: SYSTEM,
        instructionIndex: 0,
        innerIndex: 1,
        stackHeight: 3,
        kind: "cpi",
        dataHex: "03",
        accountKeys: [],
      },
    );

    graph.edges.push(
      {
        id: "a->b",
        from: "a",
        to: "b",
        outerInstructionIndex: 0,
        stackHeight: 2,
        label: "a invokes b",
      },
      {
        id: "b->c",
        from: "b",
        to: "c",
        outerInstructionIndex: 0,
        stackHeight: 3,
        label: "b invokes c",
      },
      {
        id: "c->a",
        from: "c",
        to: "a",
        outerInstructionIndex: 0,
        stackHeight: 4,
        label: "c invokes a",
      },
    );

    const cycles = detectReentrancyCycles(graph);
    assert.ok(cycles.length >= 1);

    const adj = adjacencyList(graph);
    assert.deepEqual(adj.get("a"), ["b"]);
    assert.deepEqual(adj.get("c"), ["a"]);
  });
});

describe("risk_analyzer", () => {
  it("flags deep CPI chains and unknown programs", () => {
    const accountKeys = makeAccountKeys(SYSTEM, UNKNOWN_A, UNKNOWN_B);

    const tree: CpiTreeNode[] = [
      {
        programId: SYSTEM,
        instructionIndex: 0,
        innerIndex: null,
        stackHeight: 1,
        kind: "top_level",
        data: Buffer.from([1]),
        accountIndices: [],
        children: [
          {
            programId: UNKNOWN_A,
            instructionIndex: 0,
            innerIndex: 0,
            stackHeight: 2,
            kind: "cpi",
            data: Buffer.from([2]),
            accountIndices: [],
            children: [
              {
                programId: UNKNOWN_B,
                instructionIndex: 0,
                innerIndex: 1,
                stackHeight: 3,
                kind: "cpi",
                data: Buffer.from([3]),
                accountIndices: [],
                children: [
                  {
                    programId: UNKNOWN_A,
                    instructionIndex: 0,
                    innerIndex: 2,
                    stackHeight: 4,
                    kind: "cpi",
                    data: Buffer.from([4]),
                    accountIndices: [],
                    children: [
                      {
                        programId: UNKNOWN_B,
                        instructionIndex: 0,
                        innerIndex: 3,
                        stackHeight: 5,
                        kind: "cpi",
                        data: Buffer.from([5]),
                        accountIndices: [],
                        children: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const graph = buildCausalityGraph("risk_sig", 50, null, accountKeys, tree, true);
    const report = analyzeRisk(graph, {
      maxDepthThreshold: 4,
      knownPrograms: KNOWN_PROGRAMS,
    });

    const codes = report.findings.map((finding) => finding.code);
    assert.ok(codes.includes("DEEP_CPI_CHAIN"));
    assert.ok(codes.includes("UNKNOWN_PROGRAM_CHAIN"));
    assert.equal(report.maxDepth, 5);
  });
});

describe("exporter", () => {
  it("exports valid JSON and GraphML", () => {
    const accountKeys = makeAccountKeys(SYSTEM, TOKEN);
    const tree: CpiTreeNode[] = [
      {
        programId: SYSTEM,
        instructionIndex: 0,
        innerIndex: null,
        stackHeight: 1,
        kind: "top_level",
        data: Buffer.from([9]),
        accountIndices: [1],
        children: [],
      },
    ];

    const graph = buildCausalityGraph("export_sig", 10, 123, accountKeys, tree, false);
    const risk = analyzeRisk(graph);

    const json = exportJson(graph, risk, { includeRisk: true });
    const parsed = JSON.parse(json) as { signature: string; nodeCount: number };
    assert.equal(parsed.signature, "export_sig");
    assert.equal(parsed.nodeCount, 1);

    const graphml = exportGraphMl(graph, risk);
    assert.ok(graphml.includes("<graphml"));
    assert.ok(graphml.includes('id="ix_0"'));
    assert.ok(graphml.includes("<data key=\"programId\">"));
  });
});
