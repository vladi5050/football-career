import { useState } from 'preact/hooks';
import { act, navigate, view, type Route } from '../../app/store';
import { TopBar } from '../components/TopBar';
import { Modal } from '../components/Modal';
import { IconChev, IconFlag, IconGear, IconHome, IconNews, IconPen, IconTarget } from '../components/Icons';

export function MoreScreen() {
  const v = view.value!;
  const [retire, setRetire] = useState(false);
  const open = v.career.goals.filter((g) => !g.done).length;
  const items: { route: Route; label: string; sub: string; Icon: typeof IconNews }[] = [
    { route: 'news', label: 'חדשות', sub: v.news[0]?.headline ?? 'עוד אין כותרות', Icon: IconNews },
    { route: 'goals', label: 'מטרות', sub: `${open} פתוחות`, Icon: IconTarget },
    { route: 'settings', label: 'הגדרות ושמירה', sub: 'ייצוא, ייבוא, תנועה מופחתת', Icon: IconGear },
    { route: 'editor', label: 'עורך קבוצות', sub: 'שמות משלך, רק במכשיר הזה', Icon: IconPen },
    { route: 'title', label: 'תפריט ראשי', sub: 'הקריירה נשמרת אוטומטית', Icon: IconHome },
  ];
  return (
    <main class="screen has-nav more-screen">
      <TopBar v={v} title="עוד" />
      <div class="paper list more-list">
        {items.map(({ route, label, sub, Icon }) => (
          <button key={route} type="button" class="list-row" onClick={() => navigate(route)}>
            <span class="more-ic"><Icon /></span>
            <span class="lr-main">
              <span class="lr-title">{label}</span>
              <span class="lr-sub ellipsis">{sub}</span>
            </span>
            <IconChev class="chev" />
          </button>
        ))}
      </div>
      <button class="btn btn-ghost btn-sm retire-btn" type="button" onClick={() => setRetire(true)}>
        <IconFlag size={20} /> לתלות את הנעליים
      </button>
      <Modal
        open={retire}
        title="לפרוש?"
        onClose={() => setRetire(false)}
        actions={
          <>
            <button class="btn" type="button" onClick={() => setRetire(false)}>עוד לא</button>
            <button class="btn btn-danger" type="button" onClick={() => { setRetire(false); void act({ type: 'retire' }); }}>לפרוש</button>
          </>
        }
      >
        <p>הקריירה תסתיים ותקבל כרטיס סיכום לשיתוף. אי אפשר לחזור מזה.</p>
      </Modal>
    </main>
  );
}
