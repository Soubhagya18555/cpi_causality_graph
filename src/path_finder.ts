import type { CausalityGraph, CpiEdge, CpiNode } from "./graph_types.js";
import { adjacencyList } from "./causality_builder.js";

export interface CpiPath {
  nodes: CpiNode[];
  edges: CpiEdge[];
  depth: number;
  programSequence: string[];
}

export interface PathFinderOptions {
  maxDepth?: number;
  uniqueProgramsOnly?: boolean;
}

export function findAllPaths(
  graph: CausalityGraph,
  startNodeId: string,
  options: PathFinderOptions = {},
): CpiPath[] {
  const maxDepth = options.maxDepth ?? 10;
  const adj = adjacencyList(graph);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const edgeMap = new Map(graph.edges.map((e) => [`${e.from}->${e.to}`, e]));
  const paths: CpiPath[] = [];

  function dfs(currentId: string, visited: Set<string>, nodeIds: string[], edgeIds: string[]): void {
    if (nodeIds.length > maxDepth) {
      return;
    }

    const neighbors = adj.get(currentId) ?? [];
    if (neighbors.length === 0 && nodeIds.length > 1) {
      paths.push(buildPath(nodeIds, edgeIds, nodeMap, edgeMap));
      return;
    }

    for (const nextId of neighbors) {
      if (visited.has(nextId)) {
        continue;
      }
      const edgeKey = `${currentId}->${nextId}`;
      const edge = edgeMap.get(edgeKey);
      if (!edge) {
        continue;
      }

      visited.add(nextId);
      nodeIds.push(nextId);
      edgeIds.push(edge.id);

      dfs(nextId, visited, nodeIds, edgeIds);

      edgeIds.pop();
      nodeIds.pop();
      visited.delete(nextId);
    }
  }

  dfs(startNodeId, new Set([startNodeId]), [startNodeId], []);
  return paths;
}

function buildPath(
  nodeIds: string[],
  edgeIds: string[],
  nodeMap: Map<string, CpiNode>,
  edgeMap: Map<string, CpiEdge>,
): CpiPath {
  const nodes = nodeIds.map((id) => nodeMap.get(id)!).filter(Boolean);
  const edges = edgeIds.map((id) => {
    for (const e of edgeMap.values()) {
      if (e.id === id) {
        return e;
      }
    }
    return null;
  }).filter((e): e is CpiEdge => e !== null);

  return {
    nodes,
    edges,
    depth: nodes.length,
    programSequence: nodes.map((n) => n.programId),
  };
}

export function findPathsBetween(
  graph: CausalityGraph,
  fromId: string,
  toId: string,
  maxDepth = 8,
): CpiPath[] {
  const allFromStart = findAllPaths(graph, fromId, { maxDepth });
  return allFromStart.filter((p) => p.nodes.some((n) => n.id === toId));
}

export function findLongestPath(graph: CausalityGraph): CpiPath | null {
  if (graph.nodes.length === 0) {
    return null;
  }

  const topLevel = graph.nodes.find((n) => n.kind === "top_level") ?? graph.nodes[0]!;
  const paths = findAllPaths(graph, topLevel.id, { maxDepth: 20 });

  if (paths.length === 0) {
    return {
      nodes: [topLevel],
      edges: [],
      depth: 1,
      programSequence: [topLevel.programId],
    };
  }

  return paths.reduce((longest, current) => (current.depth > longest.depth ? current : longest));
}

export function findPathsThroughProgram(
  graph: CausalityGraph,
  programId: string,
): CpiPath[] {
  const topLevel = graph.nodes.find((n) => n.kind === "top_level");
  if (!topLevel) {
    return [];
  }

  const allPaths = findAllPaths(graph, topLevel.id, { maxDepth: 15 });
  return allPaths.filter((p) => p.programSequence.includes(programId));
}

export function summarizePaths(paths: CpiPath[]): {
  count: number;
  maxDepth: number;
  uniquePrograms: string[];
  avgDepth: number;
} {
  if (paths.length === 0) {
    return { count: 0, maxDepth: 0, uniquePrograms: [], avgDepth: 0 };
  }

  const programSet = new Set<string>();
  let maxDepth = 0;
  let depthSum = 0;

  for (const path of paths) {
    maxDepth = Math.max(maxDepth, path.depth);
    depthSum += path.depth;
    for (const prog of path.programSequence) {
      programSet.add(prog);
    }
  }

  return {
    count: paths.length,
    maxDepth,
    uniquePrograms: Array.from(programSet).sort(),
    avgDepth: Math.round((depthSum / paths.length) * 100) / 100,
  };
}
