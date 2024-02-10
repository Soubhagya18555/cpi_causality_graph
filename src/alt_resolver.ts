import {
  AddressLookupTableAccount,
  Message,
  MessageV0,
  PublicKey,
  VersionedMessage,
} from "@solana/web3.js";

export interface ResolvedAccountKeys {
  staticKeys: PublicKey[];
  loadedWritable: PublicKey[];
  loadedReadonly: PublicKey[];
  fullKeys: PublicKey[];
}

export function isMessageV0(message: VersionedMessage): message is MessageV0 {
  return "addressTableLookups" in message && message.version === 0;
}

export function resolveAccountKeys(
  message: VersionedMessage,
  loadedAddresses?: { writable: PublicKey[]; readonly: PublicKey[] } | null,
): ResolvedAccountKeys {
  if (isMessageV0(message)) {
    const staticKeys = message.staticAccountKeys.slice();
    const writable = loadedAddresses?.writable ?? [];
    const readonly = loadedAddresses?.readonly ?? [];
    const fullKeys = [...staticKeys, ...writable, ...readonly];
    return {
      staticKeys,
      loadedWritable: writable,
      loadedReadonly: readonly,
      fullKeys,
    };
  }

  const legacy = message as Message;
  const legacyKeys = legacy.accountKeys.slice();
  return {
    staticKeys: legacyKeys,
    loadedWritable: [],
    loadedReadonly: [],
    fullKeys: legacyKeys,
  };
}

export function resolveProgramId(
  accountKeys: PublicKey[],
  programIdIndex: number,
): string {
  const key = accountKeys[programIdIndex];
  if (!key) {
    throw new Error(`program id index ${programIdIndex} out of bounds`);
  }
  return key.toBase58();
}

export function resolveAccountAtIndex(
  accountKeys: PublicKey[],
  index: number,
): string {
  const key = accountKeys[index];
  if (!key) {
    throw new Error(`account index ${index} out of bounds`);
  }
  return key.toBase58();
}

export function flattenLookupTables(
  tables: AddressLookupTableAccount[],
): Map<string, PublicKey[]> {
  const map = new Map<string, PublicKey[]>();
  for (const table of tables) {
    map.set(table.key.toBase58(), table.state.addresses);
  }
  return map;
}

export function describeAltUsage(message: VersionedMessage): string[] {
  if (!isMessageV0(message)) {
    return [];
  }

  return message.addressTableLookups.map((lookup) => {
    const accountKey = lookup.accountKey.toBase58();
    const writable = lookup.writableIndexes.length;
    const readonly = lookup.readonlyIndexes.length;
    return `${accountKey} (writable=${writable}, readonly=${readonly})`;
  });
}
