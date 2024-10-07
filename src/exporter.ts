import { CausalityGraph, ExportOptions, RiskReport } from "./graph_types.js";
import { programLabel } from "./risk_analyzer.js";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function exportJson(
  graph: CausalityGraph,
  risk?: RiskReport,
  options: ExportOptions = {},
): string {
  const payload: Record<string, unknown> = {
    signature: graph.signature,
    slot: graph.slot,
    blockTime: graph.blockTime,
    isVersioned: graph.isVersioned,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodes: graph.nodes.map((node) => ({
      ...node,
      programLabel: programLabel(node.programId),
    })),
    edges: graph.edges,
    accountKeys: graph.accountKeys,
  };

  if (options.includeRisk && risk) {
    payload.risk = risk;
  }

  return JSON.stringify(payload, null, options.pretty === false ? undefined : 2);
}

export function exportGraphMl(
  graph: CausalityGraph,
  risk?: RiskReport,
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="programId" for="node" attr.name="programId" attr.type="string"/>',
    '  <key id="programLabel" for="node" attr.name="programLabel" attr.type="string"/>',
    '  <key id="stackHeight" for="node" attr.name="stackHeight" attr.type="int"/>',
    '  <key id="kind" for="node" attr.name="kind" attr.type="string"/>',
    '  <key id="label" for="edge" attr.name="label" attr.type="string"/>',
    '  <key id="stackHeightEdge" for="edge" attr.name="stackHeight" attr.type="int"/>',
    '  <graph id="cpi_causality" edgedefault="directed">',
  ];

  const flaggedNodes = new Set(
    risk?.findings.flatMap((finding) => finding.nodeIds) ?? [],
  );

  for (const node of graph.nodes) {
    const attrs = [
      `id="${escapeXml(node.id)}"`,
      flaggedNodes.has(node.id) ? 'fill="#f97316"' : "",
    ]
      .filter(Boolean)
      .join(" ");

    lines.push(`    <node ${attrs}>`);
    lines.push(`      <data key="programId">${escapeXml(node.programId)}</data>`);
    lines.push(
      `      <data key="programLabel">${escapeXml(programLabel(node.programId))}</data>`,
    );
    lines.push(`      <data key="stackHeight">${node.stackHeight}</data>`);
    lines.push(`      <data key="kind">${escapeXml(node.kind)}</data>`);
    lines.push("    </node>");
  }

  for (const edge of graph.edges) {
    lines.push(
      `    <edge id="${escapeXml(edge.id)}" source="${escapeXml(edge.from)}" target="${escapeXml(edge.to)}">`,
    );
    lines.push(`      <data key="label">${escapeXml(edge.label)}</data>`);
    lines.push(`      <data key="stackHeightEdge">${edge.stackHeight}</data>`);
    lines.push("    </edge>");
  }

  lines.push("  </graph>");
  lines.push("</graphml>");

  return lines.join("\n");
}

export function exportSummary(graph: CausalityGraph, risk?: RiskReport): string {
  const lines = [
    `signature: ${graph.signature}`,
    `slot: ${graph.slot}`,
    `versioned: ${graph.isVersioned}`,
    `nodes: ${graph.nodes.length}`,
    `edges: ${graph.edges.length}`,
    "",
    "programs:",
  ];

  const programs = new Set(graph.nodes.map((node) => node.programId));
  for (const programId of [...programs].sort()) {
    lines.push(`  ${programLabel(programId)} (${programId})`);
  }

  if (risk) {
    lines.push("");
    lines.push(`risk findings: ${risk.findings.length}`);
    for (const finding of risk.findings) {
      lines.push(`  [${finding.severity}] ${finding.code}: ${finding.message}`);
    }
  }

  return lines.join("\n");
}
