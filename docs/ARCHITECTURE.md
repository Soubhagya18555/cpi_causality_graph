# Architecture

## Purpose

`cpi_causality_graph` transforms a confirmed Solana transaction into a directed graph where vertices represent program invocations and edges represent Cross Program Invocation causality. The pipeline is designed for wallet security review, incident response, and on chain forensics workflows.

## Pipeline

```
RPC getTransaction
       │
       ▼
 alt_resolver ──► full account key list (static + ALT loaded)
       │
       ▼
 cpi_extractor ──► nested CPI tree per outer instruction
       │
       ▼
 causality_builder ──► flat DAG (nodes + directed edges)
       │
       ├──► risk_analyzer ──► findings (depth, unknown, reentrancy)
       │
       └──► exporter ──► JSON / GraphML / summary
```

## Component design

### alt_resolver

Version 0 transactions reference accounts through Address Lookup Tables. The resolver merges:

1. Static account keys from the message header
2. Writable addresses loaded from ALTs (`meta.loadedAddresses.writable`)
3. Readonly addresses loaded from ALTs (`meta.loadedAddresses.readonly`)

Legacy transactions use static keys only. All downstream modules consume the flattened `fullKeys` array so program and account indices resolve consistently.

### cpi_extractor

Inner instructions arrive grouped by outer instruction index. Each inner instruction carries an optional `stackHeight` field from the RPC.

The extractor maintains a stack of active invocation frames:

- Outer instruction sits at height 1
- Each inner instruction attaches to the frame at `stackHeight - 1`
- When height decreases, frames are popped to model return from nested CPI

The output is a forest of `CpiTreeNode` values rooted at each top level instruction.

### causality_builder

The tree walk emits stable node identifiers (`ix_0`, `ix_0_inner_1_h3`, etc.) and directed edges from caller to callee. Additional helpers expose adjacency lists and cycle detection for reentrancy analysis.

The graph preserves instruction indices, stack depth, account metadata, and invocation kind (`top_level` vs `cpi`).

### risk_analyzer

Heuristic checks run over the finished graph:

| Code | Trigger |
|------|---------|
| `DEEP_CPI_CHAIN` | Stack depth meets or exceeds configurable threshold |
| `UNKNOWN_PROGRAM_CHAIN` | One or more program IDs not in the known catalog |
| `REENTRANCY_PATTERN` | Cycle detected in the causality adjacency graph |
| `REPEATED_SIBLING_INVOCATION` | Same callee invoked multiple times from one frame |

Severity scales with depth and count. The known program catalog covers core Solana programs and common DeFi routers; callers may override it for custom deployments.

### exporter

JSON export enriches nodes with human readable program labels. GraphML export targets graph visualization tools and highlights nodes referenced by risk findings.

## Data model

### CpiNode

Represents one program invocation. Includes program ID, stack height, instruction indices, hex encoded instruction data, and resolved account pubkeys.

### CpiEdge

Directed edge from caller node ID to callee node ID with outer instruction context and descriptive label.

### RiskFinding

Structured alert with severity, affected node and edge IDs, and typed metadata for downstream SIEM or case tooling.

## CLI entry

`src/index.ts` fetches the transaction with `maxSupportedTransactionVersion: 0`, orchestrates the pipeline, and prints the selected output format to stdout.

## Testing strategy

Unit tests in `src/tests/graph.test.ts` use synthetic instruction payloads. No live RPC calls are required during CI, keeping tests deterministic and fast.

## Extension points

- Plug in custom `knownPrograms` maps for protocol specific allowlists
- Lower or raise `maxDepthThreshold` per investigation profile
- Feed `buildGraphFromResponse` with archived transaction JSON for offline replay
