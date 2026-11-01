import { navigate, view } from '../../app/store';
import type { NewsItem } from '../../core/types';
import { TopBar } from '../components/TopBar';

const KIND_HE: Record<NewsItem['kind'], string> = {
  match: 'משחק', transfer: 'העברות', sacking: 'פיטורים', career: 'הקריירה שלך', rival: 'היריב', league: 'ליגה', event: 'מאחורי הקלעים',
};

export function NewsList({ items, limit }: { items: NewsItem[]; limit?: number }) {
  const list = limit ? items.slice(0, limit) : items;
  return (
    <div class="np-list">
      {list.map((n, i) => (
        <article key={`${n.absWeek}-${i}`} class={`np-item ${i === 0 && !limit ? 'lead' : ''} k-${n.kind}`}>
          <div class="np-meta">
            <span class="np-kind">{KIND_HE[n.kind]}</span>
            <span>שבוע {n.week + 1}</span>
          </div>
          <h3 class="np-h">{n.headline}</h3>
          {n.body && <p class="np-body">{n.body}</p>}
        </article>
      ))}
    </div>
  );
}

export function NewsScreen() {
  const v = view.value!;
  return (
    <main class="screen has-nav news-screen">
      <TopBar v={v} title="חדשות" onBack={() => navigate('more')} />
      <div class="newspaper full">
        <div class="np-mast">
          <span>הבועט</span>
          <span class="np-ed">עונה {v.season.number} · {v.season.year}</span>
        </div>
        {v.news.length ? <NewsList items={v.news} /> : <div class="empty">עוד אין כותרות. תן להם סיבה לכתוב.</div>}
      </div>
    </main>
  );
}
