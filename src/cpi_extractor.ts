import { PublicKey } from "@solana/web3.js";
import { resolveProgramId } from "./alt_resolver.js";
import { CpiTreeNode, InvocationKind } from "./graph_types.js";

export interface CompiledInstructionLike {
  programIdIndex: number;
  accounts: number[];
  data: string;
}

export interface InnerInstructionLike {
  index: number;
  instructions: Array<{
    programIdIndex: number;
    accounts: number[];
    data: string;
    stackHeight?: number | null;
  }>;
}

export interface TransactionMetaLike {
  innerInstructions?: InnerInstructionLike[] | null;
  loadedAddresses?: {
    writable: PublicKey[];
    readonly: PublicKey[];
  } | null;
}

function decodeInstructionData(data: string): Buffer {
  return Buffer.from(data, "base64");
}

function buildTopLevelNodes(
  accountKeys: PublicKey[],
  instructions: CompiledInstructionLike[],
): CpiTreeNode[] {
  return instructions.map((ix, index) => ({
    programId: resolveProgramId(accountKeys, ix.programIdIndex),
    instructionIndex: index,
    innerIndex: null,
    stackHeight: 1,
    kind: "top_level" as InvocationKind,
    data: decodeInstructionData(ix.data),
    accountIndices: ix.accounts.slice(),
    children: [],
  }));
}

export function extractCpiTree(
  accountKeys: PublicKey[],
  topLevelInstructions: CompiledInstructionLike[],
  meta: TransactionMetaLike | null | undefined,
): CpiTreeNode[] {
  const roots = buildTopLevelNodes(accountKeys, topLevelInstructions);
  const innerGroups = meta?.innerInstructions ?? [];

  for (const group of innerGroups) {
    const outer = roots[group.index];
    if (!outer) {
      continue;
    }

    const stack: CpiTreeNode[] = [outer];

    for (let innerIndex = 0; innerIndex < group.instructions.length; innerIndex++) {
      const ix = group.instructions[innerIndex];
      const stackHeight = ix.stackHeight ?? 2;

      while (stack.length > stackHeight - 1) {
        stack.pop();
      }

      const attachParent = stack[stack.length - 1];
      if (!attachParent) {
        continue;
      }

      const node: CpiTreeNode = {
        programId: resolveProgramId(accountKeys, ix.programIdIndex),
        instructionIndex: group.index,
        innerIndex,
        stackHeight,
        kind: "cpi",
        data: decodeInstructionData(ix.data),
        accountIndices: ix.accounts.slice(),
        children: [],
      };

      attachParent.children.push(node);
      stack.push(node);
    }
  }

  return roots;
}

export function flattenCpiTree(nodes: CpiTreeNode[]): CpiTreeNode[] {
  const flat: CpiTreeNode[] = [];

  function walk(node: CpiTreeNode): void {
    flat.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }

  for (const node of nodes) {
    walk(node);
  }

  return flat;
}

export function maxStackDepth(nodes: CpiTreeNode[]): number {
  let max = 0;

  function walk(node: CpiTreeNode): void {
    max = Math.max(max, node.stackHeight);
    for (const child of node.children) {
      walk(child);
    }
  }

  for (const node of nodes) {
    walk(node);
  }

  return max;
}

export function countCpiInvocations(nodes: CpiTreeNode[]): number {
  return flattenCpiTree(nodes).filter((node) => node.kind === "cpi").length;
}
