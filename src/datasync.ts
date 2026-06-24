import { exec } from "node:child_process";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(exec);

// Debounced git auto-sync for the data repo. Opt-in via DATA_GIT_SYNC=1, so the
// open-source code is a no-op for anyone who hasn't wired a private data repo.
// The data dir is inferred from CONTACTS_DATA_FILE (the data files live together).
const ENABLED = process.env.DATA_GIT_SYNC === "1";
const DEBOUNCE_MS = Number(process.env.DATA_GIT_SYNC_DEBOUNCE_MS ?? 10_000);
const DATA_DIR = resolve(dirname(process.env.CONTACTS_DATA_FILE ?? "./data/contacts.json"));

let timer: NodeJS.Timeout | null = null;
let pushing = false;
let dirtyWhilePushing = false;

/** Call after any mutating request. Resets a debounce window; one push fires once edits go quiet. */
export function scheduleSync(): void {
  if (!ENABLED) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), DEBOUNCE_MS);
}

async function syncNow(): Promise<void> {
  timer = null;
  if (pushing) { dirtyWhilePushing = true; return; } // coalesce: re-sync after the in-flight push
  pushing = true;
  const q = `git -C "${DATA_DIR}"`;
  try {
    const { stdout } = await run(`${q} status --porcelain`);
    if (stdout.trim()) {
      const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
      await run(`${q} add -A`);
      await run(`${q} -c commit.gpgsign=false commit -m "data: sync ${ts}"`);
    }
    await run(`${q} push`);
    if (stdout.trim()) console.log("[datasync] pushed");
  } catch (e) {
    console.error("[datasync] failed:", (e as Error).message); // never crash the server on a sync error
  } finally {
    pushing = false;
    if (dirtyWhilePushing) { dirtyWhilePushing = false; scheduleSync(); }
  }
}
