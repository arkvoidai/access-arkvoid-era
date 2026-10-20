import { get as idbGet, set as idbSet } from 'idb-keyval';
import { clearPersistedWearMap, WEAR_STORAGE_KEY } from '../world3d/terrain/Wear.ts';
import type { LedgerEvent, WorldState } from './types.ts';

export const LEDGER_STORAGE_KEY = 'arkvoid:v1:ledger';
export const STATE_STORAGE_KEY = 'arkvoid:v1:state';

const memoryFallback = new Map<string, string>();

let pendingLedger: LedgerEvent[] | null = null;
let pendingState: WorldState | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let listenersAttached = false;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

async function rawWrite(key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  memoryFallback.set(key, serialized);

  if (hasIndexedDb()) {
    try {
      await idbSet(key, value);
      return;
    } catch {
      // Fall through to localStorage
    }
  }

  if (hasLocalStorage()) {
    try {
      localStorage.setItem(key, serialized);
    } catch {
      // Memory fallback already holds latest
    }
  }
}

async function rawRead<T>(key: string): Promise<T | null> {
  if (hasIndexedDb()) {
    try {
      const val = await idbGet<T>(key);
      if (val !== undefined && val !== null) {
        return val;
      }
    } catch {
      // Fall through
    }
  }

  if (hasLocalStorage()) {
    try {
      const str = localStorage.getItem(key);
      if (str) return JSON.parse(str) as T;
    } catch {
      // Fall through
    }
  }

  const mem = memoryFallback.get(key);
  if (mem) {
    try {
      return JSON.parse(mem) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export async function flushPersistence(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const ledgerToSave = pendingLedger;
  const stateToSave = pendingState;
  pendingLedger = null;
  pendingState = null;

  const writes: Promise<void>[] = [];
  if (ledgerToSave !== null) {
    writes.push(rawWrite(LEDGER_STORAGE_KEY, ledgerToSave));
  }
  if (stateToSave !== null) {
    writes.push(rawWrite(STATE_STORAGE_KEY, stateToSave));
  }
  if (writes.length > 0) {
    await Promise.all(writes);
  }
}

function ensureLifecycleFlush(): void {
  if (listenersAttached || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  listenersAttached = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushPersistence();
    }
  });

  window.addEventListener('pagehide', () => {
    void flushPersistence();
  });
}

export function schedulePersist(ledger?: LedgerEvent[], state?: WorldState): void {
  ensureLifecycleFlush();
  if (ledger !== undefined) {
    pendingLedger = ledger;
  }
  if (state !== undefined) {
    pendingState = state;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    void flushPersistence();
  }, 250);
}

export async function loadPersistedWorld(): Promise<{
  ledger: LedgerEvent[] | null;
  state: WorldState | null;
}> {
  const [ledger, state] = await Promise.all([
    rawRead<LedgerEvent[]>(LEDGER_STORAGE_KEY),
    rawRead<WorldState>(STATE_STORAGE_KEY),
  ]);
  return {
    ledger: Array.isArray(ledger) ? ledger : null,
    state: state && typeof state === 'object' && state.version === 1 ? state : null,
  };
}

export async function clearPersistedWorld(): Promise<void> {
  pendingLedger = null;
  pendingState = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  memoryFallback.delete(LEDGER_STORAGE_KEY);
  memoryFallback.delete(STATE_STORAGE_KEY);
  memoryFallback.delete(WEAR_STORAGE_KEY);

  await clearPersistedWearMap();

  if (hasIndexedDb()) {
    try {
      await Promise.all([
        idbSet(LEDGER_STORAGE_KEY, null),
        idbSet(STATE_STORAGE_KEY, null),
        idbSet(WEAR_STORAGE_KEY, null),
      ]);
    } catch {
      // Ignore
    }
  }
  if (hasLocalStorage()) {
    try {
      localStorage.removeItem(LEDGER_STORAGE_KEY);
      localStorage.removeItem(STATE_STORAGE_KEY);
      localStorage.removeItem(WEAR_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}
