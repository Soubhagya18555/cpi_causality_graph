import type { CausalityGraph, CpiEdge, CpiNode, RiskReport } from "./graph_types.js";

export interface DotExportOptions {
  rankdir?: "TB" | "LR" | "BT" | "RL";
  includeRiskColors?: boolean;
  programLabelLength?: number;
}

function truncateProgram(programId: string, maxLen: number): string {
  if (programId.length <= maxLen) {
    return programId;
  }
  return `${programId.slice(0, maxLen)}...`;
}

function nodeColor(node: CpiNode, risk: RiskReport | null, includeRisk: boolean): string {
  if (!includeRisk || !risk) {
    return node.kind === "top_level" ? "#4a90d9" : "#7cb342";
  }
  const flagged = risk.findings.some((f) => f.nodeIds.includes(node.id));
  if (flagged) {
    return "#e53935";
  }
  return node.stackHeight > 3 ? "#ff9800" : "#7cb342";
}

function escapeDotLabel(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function exportDot(
  graph: CausalityGraph,
  risk: RiskReport | null = null,
  options: DotExportOptions = {},
): string {
  const rankdir = options.rankdir ?? "TB";
  const includeRisk = options.includeRiskColors ?? true;
  const labelLen = options.programLabelLength ?? 12;

  const lines: string[] = [
    "digraph cpi_causality {",
    `  rankdir=${rankdir};`,
    '  node [shape=box, style=filled, fontname="Consolas"];',
    '  edge [fontname="Consolas", fontsize=10];',
    "",
    `  label="${escapeDotLabel(`CPI Causality: ${graph.signature.slice(0, 16)}...`)}";`,
    "  labelloc=t;",
    "",
  ];

  for (const node of graph.nodes) {
    const label = truncateProgram(node.programId, labelLen);
    const color = nodeColor(node, risk, includeRisk);
    const tooltip = `${node.id}\\nstack=${node.stackHeight}\\naccounts=${node.accountKeys.length}`;
    lines.push(
      `  "${node.id}" [label="${escapeDotLabel(label)}\\n${node.kind}", fillcolor="${color}", tooltip="${tooltip}"];`,
    );
  }

  lines.push("");

  for (const edge of graph.edges) {
    lines.push(
      `  "${edge.from}" -> "${edge.to}" [label="h${edge.stackHeight}"];`,
    );
  }

  lines.push("}", "");
  return lines.join("\n");
}

export function exportDotSubgraph(
  graph: CausalityGraph,
  nodeIds: Set<string>,
  options: DotExportOptions = {},
): string {
  const filteredNodes = graph.nodes.filter((n) => nodeIds.has(n.id));
  const filteredEdges = graph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const sub: CausalityGraph = {
    ...graph,
    nodes: filteredNodes,
    edges: filteredEdges,
  };

  return exportDot(sub, null, options);
}

export function edgesToDotCluster(edges: CpiEdge[], label: string): string {
  const lines = [`subgraph cluster_${label.replace(/\W/g, "_")} {`, `  label="${escapeDotLabel(label)}";`];
  for (const edge of edges) {
    lines.push(`  "${edge.from}" -> "${edge.to}";`);
  }
  lines.push("}");
  return lines.join("\n");
}
