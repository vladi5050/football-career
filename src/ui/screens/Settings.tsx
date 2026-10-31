import { useState } from 'preact/hooks';
import { act, deleteSave, exportSaveJson, hasSave, importSave, navigate, setUiSetting, toast, uiSettings, view } from '../../app/store';
import { downloadText, pickTextFile } from '../../app/save';
import { TopBar } from '../components/TopBar';
import { Modal } from '../components/Modal';
import { IconDownload, IconUpload } from '../components/Icons';

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
    <main class={`screen settings-screen ${v?.phase === 'plan' ? 'has-nav' : ''}`}>
      <TopBar v={null} title="הגדרות" sub="נשמר רק במכשיר הזה" onBack={() => navigate(v ? 'more' : 'title')} right={<span />} />

      <section class="paper settings-group">
        <h2 class="paper-title">משחק</h2>
        <Toggle
          label="סמלץ רגעי מפתח אוטומטית"
          sub="המשחק ירוץ בלי לעצור לרגעים. אפשר תמיד לשנות"
          on={s.autoMoments}
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
