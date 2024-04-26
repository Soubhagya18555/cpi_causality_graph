import { PublicKey } from "@solana/web3.js";
import { resolveAccountAtIndex } from "./alt_resolver.js";
import { CpiTreeNode } from "./graph_types.js";
import { CausalityGraph, CpiEdge, CpiNode } from "./graph_types.js";

function nodeId(node: CpiTreeNode): string {
  if (node.innerIndex === null) {
    return `ix_${node.instructionIndex}`;
  }
  return `ix_${node.instructionIndex}_inner_${node.innerIndex}_h${node.stackHeight}`;
}

function edgeId(from: string, to: string, outerIndex: number): string {
  return `${from}->${to}@${outerIndex}`;
}

function resolveNodeAccounts(
  accountKeys: PublicKey[],
  accountIndices: number[],
): string[] {
  return accountIndices.map((index) => resolveAccountAtIndex(accountKeys, index));
}

function treeNodeToGraphNode(
  node: CpiTreeNode,
  accountKeys: PublicKey[],
): CpiNode {
  return {
    id: nodeId(node),
    programId: node.programId,
    instructionIndex: node.instructionIndex,
    innerIndex: node.innerIndex,
    stackHeight: node.stackHeight,
    kind: node.kind,
    dataHex: node.data.toString("hex"),
    accountKeys: resolveNodeAccounts(accountKeys, node.accountIndices),
  };
}

function inferCaller(
  node: CpiTreeNode,
  parent: CpiTreeNode | null,
): CpiTreeNode | null {
  if (node.kind === "top_level") {
    return null;
  }
  return parent;
}

function walkTree(
  node: CpiTreeNode,
  parent: CpiTreeNode | null,
  accountKeys: PublicKey[],
  nodes: CpiNode[],
  edges: CpiEdge[],
): void {
  nodes.push(treeNodeToGraphNode(node, accountKeys));

  const caller = inferCaller(node, parent);
  if (caller) {
    const from = nodeId(caller);
    const to = nodeId(node);
    edges.push({
      id: edgeId(from, to, node.instructionIndex),
      from,
      to,
      outerInstructionIndex: node.instructionIndex,
      stackHeight: node.stackHeight,
      label: `${caller.programId.slice(0, 8)} invokes ${node.programId.slice(0, 8)}`,
    });
  }

  for (const child of node.children) {
    walkTree(child, node, accountKeys, nodes, edges);
  }
}

export function buildCausalityGraph(
  signature: string,
  slot: number,
  blockTime: number | null,
  accountKeys: PublicKey[],
  tree: CpiTreeNode[],
  isVersioned: boolean,
): CausalityGraph {
  const nodes: CpiNode[] = [];
  const edges: CpiEdge[] = [];

  for (const root of tree) {
    walkTree(root, null, accountKeys, nodes, edges);
  }

  return {
    signature,
    slot,
    blockTime,
    nodes,
    edges,
    accountKeys: accountKeys.map((key) => key.toBase58()),
    isVersioned,
  };
}

export function graphMaxDepth(graph: CausalityGraph): number {
  if (graph.nodes.length === 0) {
    return 0;
  }
  return Math.max(...graph.nodes.map((node) => node.stackHeight));
}

export function uniqueProgramIds(graph: CausalityGraph): string[] {
  const set = new Set(graph.nodes.map((node) => node.programId));
  return [...set].sort();
}

export function findNodeById(
  graph: CausalityGraph,
  id: string,
): CpiNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

export function adjacencyList(
  graph: CausalityGraph,
): Map<string, string[]> {
  const adj = new Map<string, string[]>();

  for (const node of graph.nodes) {
    adj.set(node.id, []);
  }

  for (const edge of graph.edges) {
    const list = adj.get(edge.from);
    if (list) {
      list.push(edge.to);
    }
  }

  return adj;
}

export function detectReentrancyCycles(graph: CausalityGraph): string[][] {
  const adj = adjacencyList(graph);
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(nodeIdValue: string): void {
    if (visiting.has(nodeIdValue)) {
      const start = path.indexOf(nodeIdValue);
      if (start >= 0) {
        cycles.push(path.slice(start).concat(nodeIdValue));
      }
      return;
    }

    if (visited.has(nodeIdValue)) {
      return;
    }

    visiting.add(nodeIdValue);
    path.push(nodeIdValue);

    for (const next of adj.get(nodeIdValue) ?? []) {
      dfs(next);
    }

    path.pop();
    visiting.delete(nodeIdValue);
    visited.add(nodeIdValue);
  }

  for (const node of graph.nodes) {
    dfs(node.id);
  }

  return cycles;
}
