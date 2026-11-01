import { useEffect, useMemo, useState } from 'preact/hooks';
import type { CrestSpec } from '../../core/types';
import type { LeagueSeed } from '../../core/content';
import { navigate, toast, view } from '../../app/store';
import { downloadText, pickTextFile, teamNames, type TeamNamesFile } from '../../app/save';
import { TopBar } from '../components/TopBar';
import { Crest } from '../components/Crest';
import { IconDownload, IconLock, IconPen, IconUpload } from '../components/Icons';

// Content is owned by the Content dept; load it if present without making the build depend on it.
const contentMods = import.meta.glob('../../content/leagues.json', { eager: true }) as Record<string, { default?: { leagues: LeagueSeed[] }; leagues?: LeagueSeed[] }>;
function contentLeagues(): LeagueSeed[] {
  const m = Object.values(contentMods)[0];
  return m?.default?.leagues ?? m?.leagues ?? [];
}
function hashCrest(name: string, charge?: number): CrestSpec {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  h >>>= 0;
  return [h % 6, (h >>> 3) % 10, (h >>> 7) % 14, charge ?? (h >>> 11) % 11];
}

interface EdClub { key: string; name: string; short: string; city: string; colors: [string, string]; crest: CrestSpec }
interface EdLeague { key: string; name: string; country: string; clubs: EdClub[] }

const EMPTY: TeamNamesFile = { format: 'football-career-names', version: 1, clubs: {} };

export function TeamEditorScreen() {
  const v = view.value;
  const leagues = useMemo<EdLeague[]>(() => {
    const c = contentLeagues();
    if (c.length)
      return c.map((l) => ({
        key: l.key, name: l.name, country: l.country,
        clubs: l.clubs.map((cl) => ({ key: cl.name, name: cl.name, short: cl.short, city: cl.city, colors: cl.colors, crest: hashCrest(cl.name, cl.crestCharge) })),
      }));
    if (v?.league)
      return [{ key: 'cur', name: v.league.name, country: v.league.country, clubs: v.table.map((r) => ({ key: r.name, name: r.name, short: r.short, city: '', colors: r.colors, crest: r.crest })) }];
    return [];
  }, [v?.league?.id]);

  const [file, setFile] = useState<TeamNamesFile>(EMPTY);
  const [li, setLi] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', short: '' });
  useEffect(() => {
    void teamNames.read().then((f) => f && setFile(f));
  }, []);

  const save = async (next: TeamNamesFile) => {
    setFile(next);
    await teamNames.write(next);
  };
  const startEdit = (c: EdClub) => {
    const o = file.clubs[c.key];
    setDraft({ name: o?.name ?? c.name, short: o?.short ?? c.short });
    setEditing(c.key);
  };
  const commit = async (c: EdClub) => {
    const clubs = { ...file.clubs };
    const name = draft.name.trim();
    const short = draft.short.trim();
    if ((!name || name === c.name) && (!short || short === c.short)) delete clubs[c.key];
    else clubs[c.key] = { ...(name && name !== c.name ? { name } : {}), ...(short && short !== c.short ? { short } : {}) };
    await save({ ...file, clubs });
    setEditing(null);
  };
  const doImport = async () => {
    const text = await pickTextFile();
    if (!text) return;
    try {
      const parsed = JSON.parse(text) as TeamNamesFile;
      if (parsed.format !== 'football-career-names' || typeof parsed.clubs !== 'object') throw new Error('bad');
      await save(parsed);
      toast(`נטענו ${Object.keys(parsed.clubs).length} שמות`);
    } catch {
      toast('הקובץ לא נראה כמו קובץ שמות של המשחק');
    }
  };
  const doExport = () => downloadText('karyera-names.json', JSON.stringify(file.clubs && Object.keys(file.clubs).length ? file : { ...EMPTY, clubs: Object.fromEntries((leagues[li]?.clubs ?? []).map((c) => [c.key, { name: c.name, short: c.short }])) }, null, 2));

  const league = leagues[li];
  const changed = Object.keys(file.clubs).length;

  return (
    <main class={`screen team-editor ${v?.phase === 'plan' ? 'has-nav' : ''}`}>
      <TopBar v={null} title="עורך קבוצות" sub={changed ? `${changed} שמות שונו` : 'שמות בדיוניים כברירת מחדל'} onBack={() => navigate(v ? 'more' : 'title')} right={<span />} />

      <div class="privacy-note">
        <IconLock size={20} />
        <p>
          <b>נשאר רק אצלך.</b> השמות נשמרים במכשיר הזה בלבד ולא עולים לשום שרת. שינויים חלים על קריירה חדשה.
        </p>
      </div>

      <div class="btn-row">
        <button class="btn btn-sm" type="button" onClick={doImport}><IconUpload size={20} /> טען קובץ שמות</button>
        <button class="btn btn-sm" type="button" onClick={doExport}><IconDownload size={20} /> שמור לקובץ</button>
      </div>

      {leagues.length > 1 && (
        <div class="league-tabs" role="tablist">
          {leagues.map((l, i) => (
            <button key={l.key} role="tab" type="button" aria-selected={i === li} class={`chip ${i === li ? 'chip-orange' : ''}`} onClick={() => setLi(i)}>
              {l.name}
            </button>
          ))}
        </div>
      )}

      {league ? (
        <div class="paper list">
          <div class="label">{league.name} · {league.country}</div>
          {league.clubs.map((c) => {
            const o = file.clubs[c.key];
            const name = o?.name ?? c.name;
            const short = o?.short ?? c.short;
            return editing === c.key ? (
              <form key={c.key} class="edit-row" onSubmit={(e) => { e.preventDefault(); void commit(c); }}>
                <Crest spec={c.crest} colors={c.colors} name={name} short={short} size={34} />
                <input class="input" value={draft.name} aria-label="שם" onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} />
                <input class="input short" value={draft.short} aria-label="קיצור" maxLength={8} onInput={(e) => setDraft({ ...draft, short: (e.target as HTMLInputElement).value })} />
                <button class="btn btn-primary btn-sm" type="submit">שמור</button>
              </form>
            ) : (
              <button key={c.key} type="button" class="list-row" onClick={() => startEdit(c)}>
                <Crest spec={c.crest} colors={c.colors} name={name} short={short} size={34} />
                <span class="lr-main">
                  <span class="lr-title">{name}{o && <span class="chip chip-yellow edited">שונה</span>}</span>
                  <span class="lr-sub">{short}{c.city ? ` · ${c.city}` : ''}{o ? ` · במקור: ${c.name}` : ''}</span>
                </span>
                <IconPen class="chev" size={20} />
              </button>
            );
          })}
        </div>
      ) : (
        <div class="paper empty">קובץ הקבוצות עוד לא זמין. אפשר לטעון קובץ שמות, והוא יחול על הקריירה הבאה.</div>
      )}
      {changed > 0 && (
        <button class="btn btn-ghost btn-sm" type="button" onClick={async () => { await teamNames.clear(); setFile(EMPTY); toast('חזרנו לשמות המקוריים'); }}>
          לחזור לשמות המקוריים
        </button>
      )}
    </main>
  );
}
