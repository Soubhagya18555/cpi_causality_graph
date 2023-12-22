# cpi_causality_graph

Reconstruct Cross Program Invocation (CPI) causality directed acyclic graphs from Solana versioned transactions.

## Overview

`cpi_causality_graph` traces on chain transactions and builds a causality DAG that maps which program invoked which downstream program. The tool resolves Address Lookup Table (ALT) expanded account keys for version 0 transactions, walks inner instruction stacks, exports GraphML or JSON, and surfaces forensic risk signals such as deep CPI nesting, unknown program chains, and reentrancy patterns.

## Install

```bash
npm install
npm run build
```

## CLI

```bash
cpi_causality_graph trace <signature> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--rpc <url>` | Solana RPC endpoint (default: `SOLANA_RPC_URL` or mainnet) |
| `--format json` | JSON output with nodes, edges, and risk report |
| `--format graphml` | GraphML for Gephi, yEd, or NetworkX |
| `--format summary` | Human readable summary |
| `--max-depth <n>` | Deep CPI risk threshold (default: 4) |
| `--no-risk` | Omit risk section from JSON |

### Examples

```bash
npm run build
node dist/index.js trace 5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoRBJtj

node dist/index.js trace <signature> --format graphml > causality.graphml

SOLANA_RPC_URL=https://api.devnet.solana.com node dist/index.js trace <signature> --format summary
```

## Library usage

```typescript
import { traceTransaction } from "cpi_causality_graph";

const json = await traceTransaction("<signature>", {
  format: "json",
  includeRisk: true,
});
```

## Modules

| Module | Role |
|--------|------|
| `graph_types` | Shared DAG node, edge, and risk types |
| `alt_resolver` | Versioned message account key resolution |
| `cpi_extractor` | Inner instruction CPI tree extraction |
| `causality_builder` | CPI tree to causality DAG conversion |
| `risk_analyzer` | Depth, unknown program, and reentrancy heuristics |
| `exporter` | JSON and GraphML serialization |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for pipeline details.

## Development

```bash
npm test
npm run build
```

## License

MIT © Soubhagya
