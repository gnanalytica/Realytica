import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PropertyCase } from '@valytica/shared';

/**
 * JSON-file backed store.
 *
 * The whole dataset is small (a handful of property cases), so we keep it
 * entirely in memory and mirror it to disk. Writes are debounced so a burst
 * of PATCHes (e.g. ticking off several actions) collapses into one disk
 * write, and every write is atomic (write to a temp file, then rename) so a
 * crash mid-write can never leave `valytica.json` truncated or corrupt.
 */

export interface StoreData {
  cases: PropertyCase[];
  /** Monotonic counter used to mint human references like "VPS-0001". */
  nextReferenceSeq: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.VALYTICA_DATA_DIR
  ? path.resolve(process.env.VALYTICA_DATA_DIR)
  : path.resolve(here, '../data');

export const DATA_FILE = path.join(DATA_DIR, 'valytica.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const WRITE_DEBOUNCE_MS = 150;

function emptyStore(): StoreData {
  return { cases: [], nextReferenceSeq: 1 };
}

function loadStore(): StoreData {
  try {
    if (!fs.existsSync(DATA_FILE)) return emptyStore();
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    if (!raw.trim()) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    return {
      cases: Array.isArray(parsed.cases) ? parsed.cases : [],
      nextReferenceSeq:
        typeof parsed.nextReferenceSeq === 'number' && Number.isFinite(parsed.nextReferenceSeq)
          ? parsed.nextReferenceSeq
          : 1,
    };
  } catch (err) {
    console.warn(
      `[store] failed to load ${DATA_FILE}, starting from an empty store: ${(err as Error).message}`,
    );
    return emptyStore();
  }
}

class Store {
  data: StoreData;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    this.data = loadStore();
  }

  /** Mint the next human-readable case reference, e.g. "VPS-0001". */
  nextReference(): string {
    const seq = this.data.nextReferenceSeq;
    this.data.nextReferenceSeq += 1;
    return `VPS-${String(seq).padStart(4, '0')}`;
  }

  /** Debounced persist — call after every mutation of `store.data`. */
  scheduleSave(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, WRITE_DEBOUNCE_MS);
  }

  /** Synchronously write the current state to disk right now. */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DATA_FILE);
  }
}

export const store = new Store();

/** Directory that holds uploaded files for one case. Always built from a
 * case id we already found in the store — never from a raw path param. */
export function caseUploadDir(caseId: string): string {
  return path.join(UPLOADS_DIR, caseId);
}
