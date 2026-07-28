#!/usr/bin/env node

export * from "./alt_resolver.js";
export * from "./causality_builder.js";
export * from "./cpi_extractor.js";
export * from "./dot_exporter.js";
export * from "./exporter.js";
export * from "./graph_types.js";
export * from "./instruction_decoder.js";
export * from "./path_finder.js";
export * from "./risk_analyzer.js";
export * from "./timeline.js";

import { Connection, VersionedTransactionResponse } from "@solana/web3.js";
import { resolveAccountKeys } from "./alt_resolver.js";
import { buildCausalityGraph } from "./causality_builder.js";
import { extractCpiTree } from "./cpi_extractor.js";
import { exportGraphMl, exportJson, exportSummary } from "./exporter.js";
import { analyzeRisk, summarizeRisk } from "./risk_analyzer.js";

const DEFAULT_RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export interface TraceOptions {
  rpcUrl?: string;
  format?: "json" | "graphml" | "summary";
  includeRisk?: boolean;
  maxDepthThreshold?: number;
}

export async function traceTransaction(
  signature: string,
  options: TraceOptions = {},
): Promise<string> {
  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC;
  const connection = new Connection(rpcUrl, "confirmed");

  const response = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!response) {
    throw new Error(`transaction not found: ${signature}`);
  }

  const graph = buildGraphFromResponse(signature, response);
  const risk = analyzeRisk(graph, {
    maxDepthThreshold: options.maxDepthThreshold,
  });

  const format = options.format ?? "json";

  switch (format) {
    case "graphml":
      return exportGraphMl(graph, risk);
    case "summary":
      return `${exportSummary(graph, risk)}\n\n${summarizeRisk(risk)}`;
    case "json":
    default:
      return exportJson(graph, risk, { includeRisk: options.includeRisk ?? true });
  }
}

export function buildGraphFromResponse(
  signature: string,
  response: VersionedTransactionResponse,
) {
  const message = response.transaction.message;
  const meta = response.meta;

  if (!meta) {
    throw new Error("transaction meta missing; cannot extract CPI tree");
  }

  const resolved = resolveAccountKeys(message, meta.loadedAddresses ?? null);
  const accountKeys = resolved.fullKeys;

  const compiledInstructions = message.compiledInstructions.map((ix) => ({
    programIdIndex: ix.programIdIndex,
    accounts: [...ix.accountKeyIndexes],
    data: Buffer.from(ix.data).toString("base64"),
  }));

  const tree = extractCpiTree(accountKeys, compiledInstructions, {
    innerInstructions: meta.innerInstructions?.map((group) => ({
      index: group.index,
      instructions: group.instructions.map((ix) => {
        const inner = ix as typeof ix & { stackHeight?: number | null };
        return {
          programIdIndex: inner.programIdIndex,
          accounts: [...inner.accounts],
          data: inner.data,
          stackHeight: inner.stackHeight ?? null,
        };
      }),
    })),
    loadedAddresses: meta.loadedAddresses ?? null,
  });

  return buildCausalityGraph(
    signature,
    response.slot,
    response.blockTime ?? null,
    accountKeys,
    tree,
    message.version === 0,
  );
}

function printUsage(): void {
  console.error(`cpi_causality_graph - Solana CPI causality DAG tracer

Usage:
  cpi_causality_graph trace <signature> [options]

Options:
  --rpc <url>           RPC endpoint (default: SOLANA_RPC_URL or mainnet)
  --format <json|graphml|summary>
  --max-depth <n>       Risk threshold for deep CPI chains (default: 4)
  --no-risk             Omit risk section from JSON output
  --help                Show this help

Examples:
  cpi_causality_graph trace 5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoRBJtj
  cpi_causality_graph trace <sig> --format graphml > graph.graphml
`);
}

function parseArgs(argv: string[]): {
  command: string | null;
  signature: string | null;
  options: TraceOptions;
} {
  const options: TraceOptions = { includeRisk: true };
  let command: string | null = null;
  let signature: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      command = "help";
      continue;
    }

    if (arg === "--rpc") {
      options.rpcUrl = argv[++i];
      continue;
    }

    if (arg === "--format") {
      const value = argv[++i] as TraceOptions["format"];
      options.format = value;
      continue;
    }

    if (arg === "--max-depth") {
      options.maxDepthThreshold = Number(argv[++i]);
      continue;
    }

    if (arg === "--no-risk") {
      options.includeRisk = false;
      continue;
    }

    if (!command) {
      command = arg;
      continue;
    }

    if (!signature) {
      signature = arg;
    }
  }

  return { command, signature, options };
}

async function main(): Promise<void> {
  const { command, signature, options } = parseArgs(process.argv.slice(2));

  if (command === "help" || !command) {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  if (command !== "trace") {
    console.error(`unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  if (!signature) {
    console.error("missing transaction signature");
    printUsage();
    process.exit(1);
  }

  if (signature.length < 80 || signature.length > 100) {
    console.error("invalid signature length");
    process.exit(1);
  }

  const output = await traceTransaction(signature, options);
  console.log(output);
}

const entryPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (entryPath.endsWith("/index.js") || entryPath.endsWith("/index.ts")) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    process.exit(1);
  });
}
