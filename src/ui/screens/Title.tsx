import { busy, continueCareer, hasSave, navigate, saveMeta, view } from '../../app/store';
import { ShirtOnHook } from '../components/Shirt';
import { IconGear, IconPen } from '../components/Icons';

export function TitleScreen() {
  const v = view.value;
  const meta = saveMeta.value;
  const canContinue = !!v || hasSave.value;
  const mine = v ? { name: v.player.name.split(' ').slice(-1)[0] ?? '', shirt: v.player.shirt, colors: v.club?.colors ?? (['#F28C28', '#1B2A4A'] as [string, string]) } : meta ? { name: meta.name.split(' ').slice(-1)[0] ?? '', shirt: meta.shirt, colors: meta.colors } : null;

  const onContinue = async () => {
    if (v) return navigate('week');
    if (await continueCareer()) navigate('week', { replace: true });
  };

  return (
    <main class="screen title-screen">
      <div class="title-lockers" aria-hidden="true">
        <div class="locker-shelf" />
        <div class="locker-row">
          <ShirtOnHook name="שכונה" number={7} colors={['#1E4FD8', '#F7F7F2']} width={96} />
          {mine ? (
            <ShirtOnHook name={mine.name} number={mine.shirt} colors={mine.colors} width={128} swing />
          ) : (
            <ShirtOnHook name="אתה" number={10} colors={['#F28C28', '#1B2A4A']} width={128} swing />
          )}
          <ShirtOnHook name="חלום" number={9} colors={['#D7263D', '#F7F7F2']} width={96} />
        </div>
        <div class="locker-bench" />
      </div>

      <div class="title-logo">
        <h1 class="display">קריירה</h1>
        <p class="title-tag">מהשכונה לפסגה. בן 15, והחלום עדיין רחוק.</p>
      </div>

      <div class="title-actions">
        {canContinue && (
          <button class="btn btn-primary btn-block btn-col" type="button" onClick={onContinue} disabled={busy.value}>
            המשך קריירה
            {(v || meta) && (
              <span class="sub">
                {v ? `${v.player.name} · ${v.club?.name ?? ''}` : `${meta!.name} · ${meta!.club} · שבוע ${meta!.week}`}
              </span>
            )}
          </button>
        )}
        <button class={`btn ${canContinue ? '' : 'btn-primary'} btn-block`} type="button" onClick={() => navigate('new')}>
          קריירה חדשה
        </button>
        <div class="title-row">
          <button class="btn btn-ghost btn-sm" type="button" onClick={() => navigate('editor')}>
            <IconPen size={20} /> עורך קבוצות
          </button>
          <button class="btn btn-ghost btn-sm" type="button" onClick={() => navigate('settings')}>
            <IconGear size={20} /> הגדרות
          </button>
        </div>
      </div>
    </main>
  );
}
