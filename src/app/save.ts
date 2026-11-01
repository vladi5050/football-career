// Local persistence: IndexedDB via idb-keyval. One autosave slot + file export/import.
import { get, set, del, createStore, type UseStore } from 'idb-keyval';

const SLOT = 'autosave';
const NAMES = 'teamNames';
let store: UseStore | null = null;
function db(): UseStore {
  if (!store) store = createStore('football-career', 'saves');
  return store;
}

let persistAsked = false;
/** Ask the browser not to evict our data (Safari wipes after 7 idle days otherwise). */
export async function requestPersistence(): Promise<boolean> {
  if (persistAsked) return false;
  persistAsked = true;
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}

export const autosave = {
  async read(): Promise<string | null> {
    try {
      return ((await get<string>(SLOT, db())) ?? null) as string | null;
    } catch {
      return null;
    }
  },
  async write(json: string): Promise<void> {
    await set(SLOT, json, db());
    await set(`${SLOT}.meta`, { savedAt: Date.now(), size: json.length }, db());
    void requestPersistence();
  },
  async clear(): Promise<void> {
    await del(SLOT, db());
    await del(`${SLOT}.meta`, db());
  },
  async exists(): Promise<boolean> {
    return (await this.read()) != null;
  },
};

/** Team-name overrides (Team editor). Stored only on this device, never uploaded. */
export interface TeamNamesFile {
  format: 'football-career-names';
  version: 1;
  clubs: Record<string, { name?: string; short?: string; city?: string }>; // key = original club name
}
export const teamNames = {
  async read(): Promise<TeamNamesFile | null> {
    try {
      return ((await get<TeamNamesFile>(NAMES, db())) ?? null) as TeamNamesFile | null;
    } catch {
      return null;
    }
  },
  async write(file: TeamNamesFile): Promise<void> {
    await set(NAMES, file, db());
  },
  async clear(): Promise<void> {
    await del(NAMES, db());
  },
};

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickTextFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? await f.text() : null);
    };
    input.click();
  });
}
