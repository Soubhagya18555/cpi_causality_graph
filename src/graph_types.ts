export type InvocationKind = "top_level" | "cpi";

export interface CpiNode {
  id: string;
  programId: string;
  instructionIndex: number;
  innerIndex: number | null;
  stackHeight: number;
  kind: InvocationKind;
  dataHex: string;
  accountKeys: string[];
}

export interface CpiEdge {
  id: string;
  from: string;
  to: string;
  outerInstructionIndex: number;
  stackHeight: number;
  label: string;
}

export interface CausalityGraph {
  signature: string;
  slot: number;
  blockTime: number | null;
  nodes: CpiNode[];
  edges: CpiEdge[];
  accountKeys: string[];
  isVersioned: boolean;
}

export interface CpiTreeNode {
  programId: string;
  instructionIndex: number;
  innerIndex: number | null;
  stackHeight: number;
  kind: InvocationKind;
  data: Buffer;
  accountIndices: number[];
  children: CpiTreeNode[];
}

export type RiskSeverity = "info" | "warning" | "critical";

export interface RiskFinding {
  code: string;
  severity: RiskSeverity;
  message: string;
  nodeIds: string[];
  edgeIds: string[];
  metadata: Record<string, unknown>;
}

export interface RiskReport {
  signature: string;
  findings: RiskFinding[];
  maxDepth: number;
  uniquePrograms: string[];
}

export interface ExportOptions {
  includeRisk?: boolean;
  pretty?: boolean;
}
