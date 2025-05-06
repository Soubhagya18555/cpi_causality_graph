import {
  adjacencyList,
  detectReentrancyCycles,
  graphMaxDepth,
  uniqueProgramIds,
} from "./causality_builder.js";
import { CausalityGraph, RiskFinding, RiskReport } from "./graph_types.js";

export const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "Token Program",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "Token 2022 Program",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token Program",
  "ComputeBudget111111111111111111111111111111": "Compute Budget Program",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr": "Memo Program",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s": "Metaplex Token Metadata",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter Aggregator v6",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM v4",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": "Raydium CLMM",
};

export interface RiskAnalyzerOptions {
  maxDepthThreshold?: number;
  knownPrograms?: Record<string, string>;
}

const DEFAULT_MAX_DEPTH = 4;

export function analyzeRisk(
  graph: CausalityGraph,
  options: RiskAnalyzerOptions = {},
): RiskReport {
  const maxDepthThreshold = options.maxDepthThreshold ?? DEFAULT_MAX_DEPTH;
  const knownPrograms = options.knownPrograms ?? KNOWN_PROGRAMS;
  const findings: RiskFinding[] = [];
  const maxDepth = graphMaxDepth(graph);
  const programs = uniqueProgramIds(graph);

  if (maxDepth >= maxDepthThreshold) {
    const deepNodes = graph.nodes
      .filter((node) => node.stackHeight >= maxDepthThreshold)
      .map((node) => node.id);

    findings.push({
      code: "DEEP_CPI_CHAIN",
      severity: maxDepth >= maxDepthThreshold + 2 ? "critical" : "warning",
      message: `CPI stack reaches depth ${maxDepth} (threshold ${maxDepthThreshold})`,
      nodeIds: deepNodes,
      edgeIds: graph.edges
        .filter((edge) => edge.stackHeight >= maxDepthThreshold)
        .map((edge) => edge.id),
      metadata: { maxDepth, threshold: maxDepthThreshold },
    });
  }

  const unknownPrograms = programs.filter((programId) => !knownPrograms[programId]);
  if (unknownPrograms.length > 0) {
    const unknownNodes = graph.nodes
      .filter((node) => unknownPrograms.includes(node.programId))
      .map((node) => node.id);

    findings.push({
      code: "UNKNOWN_PROGRAM_CHAIN",
      severity: unknownPrograms.length >= 3 ? "warning" : "info",
      message: `Transaction invokes ${unknownPrograms.length} unrecognized program(s)`,
      nodeIds: unknownNodes,
      edgeIds: [],
      metadata: { unknownPrograms },
    });
  }

  const cycles = detectReentrancyCycles(graph);
  for (const cycle of cycles) {
    const programTrail = cycle
      .map((id) => graph.nodes.find((node) => node.id === id)?.programId ?? id)
      .join(" -> ");

    findings.push({
      code: "REENTRANCY_PATTERN",
      severity: "critical",
      message: `Potential reentrancy cycle detected: ${programTrail}`,
      nodeIds: cycle,
      edgeIds: graph.edges
        .filter((edge) => cycle.includes(edge.from) && cycle.includes(edge.to))
        .map((edge) => edge.id),
      metadata: { cycleLength: cycle.length },
    });
  }

  const adj = adjacencyList(graph);
  for (const node of graph.nodes) {
    const callees = adj.get(node.id) ?? [];
    const calleePrograms = callees.map(
      (calleeId) => graph.nodes.find((n) => n.id === calleeId)?.programId,
    );

    const repeats = calleePrograms.filter(
      (programId, index) => programId && calleePrograms.indexOf(programId) !== index,
    );

    if (repeats.length > 0) {
      findings.push({
        code: "REPEATED_SIBLING_INVOCATION",
        severity: "warning",
        message: `Program ${node.programId.slice(0, 8)} invokes the same callee multiple times at one stack frame`,
        nodeIds: [node.id, ...callees],
        edgeIds: graph.edges.filter((edge) => edge.from === node.id).map((edge) => edge.id),
        metadata: { repeatedPrograms: [...new Set(repeats)] },
      });
    }
  }

  return {
    signature: graph.signature,
    findings,
    maxDepth,
    uniquePrograms: programs,
  };
}

export function summarizeRisk(report: RiskReport): string {
  if (report.findings.length === 0) {
    return "No risk findings";
  }

  const counts = report.findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});

  const parts = Object.entries(counts).map(([severity, count]) => `${count} ${severity}`);
  return `${report.findings.length} finding(s): ${parts.join(", ")}`;
}

export function programLabel(
  programId: string,
  knownPrograms: Record<string, string> = KNOWN_PROGRAMS,
): string {
  return knownPrograms[programId] ?? programId;
}
