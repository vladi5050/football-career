import { useState } from 'preact/hooks';
import { act, deleteSave, exportSaveJson, hasSave, importSave, navigate, setUiSetting, toast, uiSettings, view } from '../../app/store';
import { downloadText, pickTextFile } from '../../app/save';
import { TopBar } from '../components/TopBar';
import { Modal } from '../components/Modal';
import { IconDownload, IconUpload } from '../components/Icons';
import { SEASON_SPEEDS } from '../i18n';

function Toggle({ label, sub, on, onChange }: { label: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" class="toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span class="tg-text">
        <b>{label}</b>
        <small>{sub}</small>
      </span>
      <span class="switch" />
    </button>
  );
}

export function SettingsScreen() {
  const v = view.value;
  const s = uiSettings.value;
  const [confirmDel, setConfirmDel] = useState(false);
  const speed = v?.settings?.seasonSpeed ?? 'full';

  const doExport = async () => {
    try {
      const json = await exportSaveJson();
      const name = v ? v.player.name.replace(/\s+/g, '-') : 'career';
      downloadText(`karyera-${name}-w${(v?.absWeek ?? 0) + 1}.json`, json);
      toast('השמירה ירדה לקובץ');
    } catch {
      toast('אין קריירה פעילה לייצא');
    }
  };
  const doImport = async () => {
    const text = await pickTextFile();
    if (!text) return;
    if (await importSave(text)) {
      toast('הקריירה נטענה');
      navigate('week', { replace: true });
    }
  };

  return (
    <main class={`screen settings-screen ${v?.phase === 'plan' || v?.phase === 'offseason' ? 'has-nav' : ''}`}>
      <TopBar v={null} title="הגדרות" sub="נשמר רק במכשיר הזה" onBack={() => navigate(v ? 'more' : 'title')} right={<span />} />

      <section class="paper settings-group">
        <h2 class="paper-title">משחק</h2>
        <div class="moment-style" style={{ display: 'grid', gap: '8px', padding: '6px 0 10px' }}>
          <span class="tg-text" style={{ display: 'grid', gap: '2px' }}>
            <b style={{ fontSize: 'var(--t-md)' }}>סגנון רגעי מפתח</b>
            <small style={{ fontSize: 'var(--t-sm)', color: 'var(--ink-3)', fontWeight: 600 }}>
              {s.momentStyle === 'arcade' ? 'מיני-משחק: מחליקים ומקישים כדי לבעוט, למסור ולהציל' : 'קוראים את המצב על הלוח ובוחרים את ההחלטה הנכונה'}
            </small>
          </span>
          <div class="seg" role="group" aria-label="סגנון רגעי מפתח">
            <button type="button" aria-pressed={s.momentStyle !== 'arcade'} onClick={() => setUiSetting('momentStyle', 'decision')}>
              החלטות
            </button>
            <button type="button" aria-pressed={s.momentStyle === 'arcade'} onClick={() => setUiSetting('momentStyle', 'arcade')}>
              ארקייד (החלקות)
            </button>
          </div>
        </div>
        <div class="speed-pick" style={{ padding: '6px 0 10px' }}>
          <span class="tg-text" style={{ display: 'grid', gap: '2px' }}>
            <b style={{ fontSize: 'var(--t-md)' }}>קצב העונה</b>
          </span>
          <div class="seg" role="group" aria-label="קצב העונה">
            {SEASON_SPEEDS.map((o) => (
              <button key={o.id} type="button" aria-pressed={speed === o.id} disabled={!v} onClick={() => v && act({ type: 'setSeasonSpeed', value: o.id })}>
                {o.label}
              </button>
            ))}
          </div>
          <p class="speed-sub">{v ? SEASON_SPEEDS.find((o) => o.id === speed)?.sub : 'בוחרים בתחילת קריירה, ואפשר לשנות כאן בכל רגע'}</p>
        </div>
        <Toggle
          label="רגעי מפתח: המשחק מחליט בשבילי"
          sub="המשחק ירוץ בלי לעצור לרגעים. אפשר תמיד לשנות"
          on={v?.settings?.autoMoments ?? s.autoMoments}
          onChange={(val) => {
            setUiSetting('autoMoments', val);
            if (v) void act({ type: 'setAutoMoments', value: val });
          }}
        />
        <Toggle label="תנועה מופחתת" sub="בלי אנימציות, קונפטי ומעברים" on={s.reducedMotion} onChange={(val) => setUiSetting('reducedMotion', val)} />
      </section>

      <section class="paper settings-group">
        <h2 class="paper-title">שמירה</h2>
        <p class="muted">המשחק נשמר אוטומטית בסוף כל שלב. כדאי לייצא לקובץ מדי פעם, במיוחד באייפון.</p>
        <div class="btn-row">
          <button class="btn btn-sm" type="button" onClick={doExport} disabled={!v}>
            <IconDownload size={20} /> ייצוא לקובץ
          </button>
          <button class="btn btn-sm" type="button" onClick={doImport}>
            <IconUpload size={20} /> ייבוא מקובץ
          </button>
        </div>
        <button class="btn btn-danger btn-sm btn-block" type="button" onClick={() => setConfirmDel(true)} disabled={!hasSave.value && !v}>
          מחיקת השמירה
        </button>
      </section>

      <p class="wall-label about">קריירה · גרסת אב טיפוס · כל השמות והסמלים בדיוניים</p>

      <Modal
        open={confirmDel}
        title="למחוק את הקריירה?"
        onClose={() => setConfirmDel(false)}
        actions={
          <>
            <button class="btn" type="button" onClick={() => setConfirmDel(false)}>ביטול</button>
            <button class="btn btn-danger" type="button" onClick={async () => { setConfirmDel(false); await deleteSave(); toast('השמירה נמחקה'); }}>למחוק</button>
          </>
        }
      >
        <p>השמירה האוטומטית תימחק מהמכשיר. אם לא ייצאת לקובץ, אין דרך לשחזר.</p>
      </Modal>
    </main>
  );
}
