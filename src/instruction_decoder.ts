const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export type InstructionCategory =
  | "system_transfer"
  | "system_create_account"
  | "system_allocate"
  | "token_transfer"
  | "token_mint_to"
  | "token_burn"
  | "token_approve"
  | "token_close_account"
  | "token_set_authority"
  | "memo"
  | "unknown";

export interface DecodedInstruction {
  programId: string;
  category: InstructionCategory;
  discriminator: number | null;
  summary: string;
  accountCount: number;
  dataLength: number;
  rawHex: string;
}

const SYSTEM_DISCRIMINATORS: Record<number, InstructionCategory> = {
  0: "system_create_account",
  2: "system_transfer",
  8: "system_allocate",
};

const TOKEN_DISCRIMINATORS: Record<number, InstructionCategory> = {
  3: "token_transfer",
  7: "token_mint_to",
  8: "token_burn",
  4: "token_approve",
  9: "token_close_account",
  6: "token_set_authority",
};

function readDiscriminator(data: Buffer): number | null {
  if (data.length === 0) {
    return null;
  }
  return data[0] ?? null;
}

function decodeSystemInstruction(data: Buffer, accountCount: number): DecodedInstruction {
  const disc = readDiscriminator(data);
  const category = disc !== null ? (SYSTEM_DISCRIMINATORS[disc] ?? "unknown") : "unknown";

  let summary = "system program instruction";
  if (category === "system_transfer" && data.length >= 12) {
    const lamports = data.readBigUInt64LE(4);
    summary = `transfer ${lamports} lamports`;
  } else if (category === "system_create_account") {
    summary = `create account (${accountCount} accounts)`;
  } else if (category === "system_allocate") {
    summary = "allocate account data";
  }

  return {
    programId: SYSTEM_PROGRAM,
    category,
    discriminator: disc,
    summary,
    accountCount,
    dataLength: data.length,
    rawHex: data.toString("hex"),
  };
}

function decodeTokenInstruction(programId: string, data: Buffer, accountCount: number): DecodedInstruction {
  const disc = readDiscriminator(data);
  const category = disc !== null ? (TOKEN_DISCRIMINATORS[disc] ?? "unknown") : "unknown";

  let summary = "token program instruction";
  if (category === "token_transfer" && data.length >= 9) {
    const amount = data.readBigUInt64LE(1);
    summary = `transfer ${amount} tokens`;
  } else if (category === "token_mint_to" && data.length >= 9) {
    const amount = data.readBigUInt64LE(1);
    summary = `mint ${amount} tokens`;
  } else if (category === "token_burn" && data.length >= 9) {
    const amount = data.readBigUInt64LE(1);
    summary = `burn ${amount} tokens`;
  } else if (category === "token_close_account") {
    summary = "close token account";
  } else if (category === "token_approve") {
    summary = "approve delegate";
  }

  return {
    programId,
    category,
    discriminator: disc,
    summary,
    accountCount,
    dataLength: data.length,
    rawHex: data.toString("hex"),
  };
}

export function decodeInstruction(
  programId: string,
  dataHex: string,
  accountKeys: string[],
): DecodedInstruction {
  const data = Buffer.from(dataHex, "hex");
  const accountCount = accountKeys.length;

  if (programId === SYSTEM_PROGRAM) {
    return decodeSystemInstruction(data, accountCount);
  }

  if (programId === TOKEN_PROGRAM || programId === TOKEN_2022_PROGRAM) {
    return decodeTokenInstruction(programId, data, accountCount);
  }

  if (programId === MEMO_PROGRAM) {
    const text = data.toString("utf8");
    return {
      programId,
      category: "memo",
      discriminator: null,
      summary: text.length > 0 ? `memo: ${text.slice(0, 64)}` : "empty memo",
      accountCount,
      dataLength: data.length,
      rawHex: dataHex,
    };
  }

  if (programId === ASSOCIATED_TOKEN_PROGRAM) {
    return {
      programId,
      category: "unknown",
      discriminator: readDiscriminator(data),
      summary: "associated token account operation",
      accountCount,
      dataLength: data.length,
      rawHex: dataHex,
    };
  }

  return {
    programId,
    category: "unknown",
    discriminator: readDiscriminator(data),
    summary: `unknown instruction (${data.length} bytes)`,
    accountCount,
    dataLength: data.length,
    rawHex: dataHex,
  };
}

export function decodeGraphInstructions(
  nodes: Array<{ programId: string; dataHex: string; accountKeys: string[] }>,
): DecodedInstruction[] {
  return nodes.map((node) => decodeInstruction(node.programId, node.dataHex, node.accountKeys));
}

export function filterByCategory(
  decoded: DecodedInstruction[],
  categories: InstructionCategory[],
): DecodedInstruction[] {
  const set = new Set(categories);
  return decoded.filter((d) => set.has(d.category));
}

export function summarizeInstructions(decoded: DecodedInstruction[]): Map<InstructionCategory, number> {
  const counts = new Map<InstructionCategory, number>();
  for (const d of decoded) {
    counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
  }
  return counts;
}
