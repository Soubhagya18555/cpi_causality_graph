import type { CausalityGraph, CpiNode } from "./graph_types.js";
import { decodeInstruction, type DecodedInstruction } from "./instruction_decoder.js";

export interface TimelineEvent {
  sequence: number;
  nodeId: string;
  programId: string;
  kind: CpiNode["kind"];
  stackHeight: number;
  instructionIndex: number;
  innerIndex: number | null;
  decoded: DecodedInstruction;
  timestamp: number | null;
  elapsedMs: number | null;
}

export interface CpiTimeline {
  signature: string;
  slot: number;
  blockTime: number | null;
  events: TimelineEvent[];
  totalInvocations: number;
  maxStackHeight: number;
  durationMs: number | null;
}

function sortNodesForTimeline(nodes: CpiNode[]): CpiNode[] {
  return [...nodes].sort((a, b) => {
    if (a.instructionIndex !== b.instructionIndex) {
      return a.instructionIndex - b.instructionIndex;
    }
    const aInner = a.innerIndex ?? -1;
    const bInner = b.innerIndex ?? -1;
    if (aInner !== bInner) {
      return aInner - bInner;
    }
    return a.stackHeight - b.stackHeight;
  });
}

export function buildTimeline(graph: CausalityGraph): CpiTimeline {
  const sorted = sortNodesForTimeline(graph.nodes);
  const events: TimelineEvent[] = [];
  let maxStack = 0;

  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i]!;
    maxStack = Math.max(maxStack, node.stackHeight);

    const decoded = decodeInstruction(node.programId, node.dataHex, node.accountKeys);

    events.push({
      sequence: i + 1,
      nodeId: node.id,
      programId: node.programId,
      kind: node.kind,
      stackHeight: node.stackHeight,
      instructionIndex: node.instructionIndex,
      innerIndex: node.innerIndex,
      decoded,
      timestamp: graph.blockTime,
      elapsedMs: graph.blockTime !== null ? i * 0.4 : null,
    });
  }

  const durationMs =
    graph.blockTime !== null && events.length > 1
      ? (events.length - 1) * 0.4
      : null;

  return {
    signature: graph.signature,
    slot: graph.slot,
    blockTime: graph.blockTime,
    events,
    totalInvocations: events.length,
    maxStackHeight: maxStack,
    durationMs,
  };
}

export function filterTimelineByProgram(timeline: CpiTimeline, programId: string): TimelineEvent[] {
  return timeline.events.filter((e) => e.programId === programId);
}

export function filterTimelineByCategory(
  timeline: CpiTimeline,
  categories: DecodedInstruction["category"][],
): TimelineEvent[] {
  const set = new Set(categories);
  return timeline.events.filter((e) => set.has(e.decoded.category));
}

export function formatTimelineText(timeline: CpiTimeline): string {
  const lines: string[] = [
    `CPI Timeline: ${timeline.signature}`,
    `slot=${timeline.slot} invocations=${timeline.totalInvocations} max_depth=${timeline.maxStackHeight}`,
    "",
  ];

  for (const event of timeline.events) {
    const indent = "  ".repeat(Math.max(0, event.stackHeight - 1));
    const inner = event.innerIndex !== null ? `[inner ${event.innerIndex}]` : "[top]";
    lines.push(
      `${indent}${event.sequence}. ${event.programId.slice(0, 8)}... ${inner} ${event.decoded.summary}`,
    );
  }

  return lines.join("\n");
}

export function serializeTimeline(timeline: CpiTimeline): object {
  return {
    signature: timeline.signature,
    slot: timeline.slot,
    blockTime: timeline.blockTime,
    totalInvocations: timeline.totalInvocations,
    maxStackHeight: timeline.maxStackHeight,
    durationMs: timeline.durationMs,
    events: timeline.events.map((e) => ({
      sequence: e.sequence,
      nodeId: e.nodeId,
      programId: e.programId,
      kind: e.kind,
      stackHeight: e.stackHeight,
      category: e.decoded.category,
      summary: e.decoded.summary,
    })),
  };
}

export function findTokenOperations(timeline: CpiTimeline): TimelineEvent[] {
  const tokenCategories = new Set([
    "token_transfer",
    "token_mint_to",
    "token_burn",
    "token_close_account",
    "token_approve",
  ] as const);
  return timeline.events.filter((e) => tokenCategories.has(e.decoded.category as typeof tokenCategories extends Set<infer T> ? T : never));
}
