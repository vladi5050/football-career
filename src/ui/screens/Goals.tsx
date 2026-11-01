import { navigate, view } from '../../app/store';
import { TopBar } from '../components/TopBar';
import { Bar } from '../components/Bars';
import { Magnet } from '../components/Magnet';
import { IconCheck } from '../components/Icons';

export function GoalsScreen() {
  const v = view.value!;
  const goals = [...v.career.goals].sort((a, b) => Number(a.done) - Number(b.done) || b.progress / b.target - a.progress / a.target);
  return (
    <main class="screen has-nav goals-screen">
      <TopBar v={v} title="מטרות" onBack={() => navigate('more')} />
      <div class="board-wrap">
        <div class="board goals-board">
          <div class="board-title">לוח מטרות</div>
          {goals.length === 0 && <p class="empty">אין מטרות פתוחות.</p>}
          {goals.map((g) => {
            const frac = Math.min(1, g.progress / g.target);
            const left = g.target - g.progress;
            return (
              <div key={g.id} class={`goal-row ${g.done ? 'done' : ''}`}>
                <Magnet color={g.done ? 'green' : frac >= 0.8 ? 'orange' : 'blue'} size={36}>
                  {g.done ? <IconCheck size={18} /> : null}
                </Magnet>
                <div class="gr-main">
                  <div class="gr-text">{g.text}</div>
                  {!g.done && <Bar value={frac * 100} striped color={frac >= 0.8 ? undefined : 'blue'} />}
                  <div class="gr-sub">
                    {g.done ? 'הושלם' : left <= 1 && g.kind === 'attr' ? `עוד פחות מ-1!` : `${Math.floor(g.progress)}/${g.target}`}
                    <span class="gr-reward"> · פרס: {g.reward}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div class="board-tray" aria-hidden="true"><span class="marker m-red" /><span class="marker m-blue" /></div>
      </div>
    </main>
  );
}
