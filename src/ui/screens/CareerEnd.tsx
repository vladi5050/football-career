import { useEffect, useRef, useState } from 'preact/hooks';
import type { ClubView, View } from '../../core/types';
import { navigate, toast, view } from '../../app/store';
import { POS_HE, avgRating, countHe } from '../i18n';
import { clubLookup, vx } from '../viewExtras';
import { Crest, readableOn } from '../components/Crest';
import { Shirt, patternFor } from '../components/Shirt';
import { TapedCard } from '../components/TapedCard';
import { IconDownload, IconShare } from '../components/Icons';

const clubById = clubLookup;
function clubPath(v: View): ClubView[] {
  const out: ClubView[] = [];
  for (const h of v.career.history) {
    const c = clubById(v, h.clubId);
    if (c && out[out.length - 1]?.id !== c.id) out.push(c);
  }
  if (!out.length && v.club) out.push(v.club);
  return out;
}

function svgToImage(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = rej;
    img.src = url;
  });
}

/** Draws the 9:16 share card (1080x1920) and returns a PNG blob. */
async function drawCard(v: View, shirtSvg: SVGSVGElement, crestSvgs: SVGSVGElement[]): Promise<Blob> {
  await document.fonts?.ready;
  const W = 1080, H = 1920;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.direction = 'rtl';
  // locker wall
  ctx.fillStyle = '#22344F';
  ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 120) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, 0, 4, H);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x + 6, 0, 2, H);
  }
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#F28C28';
  ctx.font = '700 150px Karantina, Assistant, sans-serif';
  ctx.fillText('קריירה', W / 2, 190);
  ctx.fillStyle = '#C3CEE0';
  ctx.font = '600 40px Assistant, sans-serif';
  ctx.fillText(v.career.retirementReason ?? 'סוף הסיפור. בינתיים.', W / 2, 250);

  // framed shirt
  const fx = 170, fy = 310, fw = 740, fh = 760;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(fx + 10, fy + 18, fw, fh);
  ctx.fillStyle = '#B8BDC2';
  ctx.fillRect(fx, fy, fw, fh);
  ctx.fillStyle = '#8E959C';
  ctx.fillRect(fx + 22, fy + 22, fw - 44, fh - 44);
  ctx.fillStyle = '#F7F7F2';
  ctx.fillRect(fx + 30, fy + 30, fw - 60, fh - 60);
  const colors = v.club?.colors ?? (['#F28C28', '#1B2A4A'] as [string, string]);
  const shirtW = 560;
  const shirtH = shirtW * (150 / 140);
  const sx = W / 2 - shirtW / 2, sy = fy + 80;
  const img = await svgToImage(shirtSvg, shirtW, shirtH);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 14;
  ctx.drawImage(img, sx, sy, shirtW, shirtH);
  ctx.restore();
  const ink = readableOn(colors[0], colors[1]);
  ctx.fillStyle = ink;
  const last = v.player.name.split(' ').slice(-1)[0] ?? '';
  ctx.font = '800 54px Assistant, sans-serif';
  ctx.fillText(last, W / 2, sy + shirtH * (52 / 150));
  ctx.font = '700 300px Karantina, Assistant, sans-serif';
  ctx.fillText(String(v.player.shirt), W / 2, sy + shirtH * (124 / 150));

  // name plate
  ctx.fillStyle = '#F7F7F2';
  ctx.font = '800 76px Assistant, sans-serif';
  ctx.fillText(v.player.name, W / 2, 1170);
  ctx.fillStyle = '#C3CEE0';
  ctx.font = '600 38px Assistant, sans-serif';
  const firstYear = v.career.history[0]?.year ?? v.season.year;
  const lastYear = v.career.history[v.career.history.length - 1]?.year ?? v.season.year;
  ctx.fillText(`${POS_HE[v.player.pos]} · ${firstYear}-${lastYear + 1}`, W / 2, 1222);

  // stats
  const cs = v.player.careerStats;
  const stats: [string, string][] = [
    [String(cs.apps), 'הופעות'], [String(cs.goals), 'שערים'], [String(cs.assists), 'בישולים'], [String(v.career.nationalCaps), 'בנבחרת'],
  ];
  const bw = 220, gap = 20, totalW = stats.length * bw + (stats.length - 1) * gap;
  stats.forEach(([n, l], i) => {
    const x = W / 2 + totalW / 2 - bw - i * (bw + gap); // RTL: first box on the right
    ctx.fillStyle = '#F7F7F2';
    ctx.fillRect(x, 1270, bw, 190);
    ctx.fillStyle = '#1B2A4A';
    ctx.font = '700 120px Karantina, Assistant, sans-serif';
    ctx.fillText(n, x + bw / 2, 1390);
    ctx.font = '700 34px Assistant, sans-serif';
    ctx.fillStyle = '#44506A';
    ctx.fillText(l, x + bw / 2, 1438);
  });

  // clubs path (RTL: first club on the right); shrinks to fit the whole career
  const n = crestSvgs.length;
  const scale = Math.min(1, (W - 80) / Math.max(1, n * 120 + (n - 1) * 70));
  const cw = Math.round(120 * scale), cg = Math.round(70 * scale);
  const pathW = n * cw + (n - 1) * cg;
  for (let i = 0; i < n; i++) {
    const x = W / 2 + pathW / 2 - cw - i * (cw + cg);
    const im = await svgToImage(crestSvgs[i]!, cw, cw * 1.2);
    ctx.drawImage(im, x, 1500, cw, cw * 1.2);
    if (i < n - 1) {
      ctx.strokeStyle = '#F28C28';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const y = 1500 + cw * 0.6, a = Math.max(6, cg * 0.2);
      ctx.moveTo(x - cg * 0.2, y);
      ctx.lineTo(x - cg + cg * 0.2, y);
      ctx.moveTo(x - cg + cg * 0.2 + a, y - a);
      ctx.lineTo(x - cg + cg * 0.2, y);
      ctx.lineTo(x - cg + cg * 0.2 + a, y + a);
      ctx.stroke();
    }
  }

  // trophies
  ctx.fillStyle = '#F2C230';
  ctx.font = '700 40px Assistant, sans-serif';
  const tro = v.career.trophies.slice(0, 2).join('  ·  ');
  if (tro) ctx.fillText(`★ ${tro}`, W / 2, 1700);
  const key = vx(v).careerStory?.keyPerson;
  if (key) {
    ctx.fillStyle = '#C3CEE0';
    ctx.font = '600 34px Assistant, sans-serif';
    ctx.fillText(`האדם שהכי השפיע: ${key}`, W / 2, tro ? 1750 : 1710, W - 80);
  }

  // footer
  ctx.fillStyle = '#F28C28';
  ctx.fillRect(0, H - 150, W, 150);
  ctx.fillStyle = '#A85A10';
  ctx.fillRect(0, H - 150, W, 8);
  ctx.fillStyle = '#1B2A4A';
  ctx.font = '700 84px Karantina, Assistant, sans-serif';
  ctx.fillText('שחק את הקריירה שלך', W / 2, H - 50);

  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}

export function CareerEndScreen() {
  const v = view.value!;
  const shirtRef = useRef<HTMLDivElement>(null);
  const crestRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const clubs = clubPath(v);
  const cs = v.player.careerStats;
  const colors = v.club?.colors ?? (['#F28C28', '#1B2A4A'] as [string, string]);
  const story = vx(v).careerStory;

  useEffect(() => {
    let alive = true;
    const shirt = shirtRef.current?.querySelector('svg');
    const crests = Array.from(crestRef.current?.querySelectorAll('svg') ?? []) as SVGSVGElement[];
    if (!shirt) return;
    drawCard(v, shirt as SVGSVGElement, crests)
      .then((b) => {
        if (!alive) return;
        setBlob(b);
        setUrl(URL.createObjectURL(b));
      })
      .catch((e) => console.error('card', e));
    return () => {
      alive = false;
    };
  }, [v.absWeek, v.player.name]);

  const fileName = `karyera-${v.player.name.replace(/\s+/g, '-')}.png`;
  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  };
  const share = async () => {
    if (!blob) return;
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'הקריירה שלי', text: 'שחק את הקריירה שלך' });
      } catch {
        /* cancelled */
      }
    } else {
      download();
      toast('התמונה ירדה. אפשר לשתף אותה מהגלריה');
    }
  };

  return (
    <main class="screen has-actions career-end">
      <header class="ce-head">
        <span class="chip chip-orange">סוף הקריירה</span>
        <h1 class="h1">{v.player.name}</h1>
        <p class="muted-wall">{v.career.retirementReason ?? 'תלית את הנעליים.'}</p>
      </header>

      <div class="ce-card">
        {url ? <img src={url} alt="כרטיס הקריירה שלך לשיתוף" width={1080} height={1920} /> : <div class="ce-card-ph">מכין את הכרטיס...</div>}
      </div>

      <TapedCard tape="right" class="ce-stats">
        <div class="ce-grid">
          <div><b class="display num">{cs.apps}</b><span>הופעות</span></div>
          <div><b class="display num">{cs.goals}</b><span>שערים</span></div>
          <div><b class="display num">{cs.assists}</b><span>בישולים</span></div>
          <div><b class="display num">{avgRating(cs) || '-'}</b><span>ממוצע</span></div>
        </div>
        {v.career.trophies.length > 0 && (
          <ul class="trophies">
            {v.career.trophies.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </TapedCard>

      {(story?.turningPoint || story?.keyPerson) && (
        <section class="paper ce-story">
          {story.turningPoint && (
            <div>
              <span class="label">ההחלטה ששינתה הכל</span>
              <p>{story.turningPoint}</p>
            </div>
          )}
          {story.keyPerson && (
            <div>
              <span class="label">האדם שהכי השפיע</span>
              <p>{story.keyPerson}</p>
            </div>
          )}
        </section>
      )}

      {v.career.history.length > 0 && (
        <section class="paper ce-timeline">
          <h2 class="paper-title">הדרך</h2>
          {v.career.history.map((h) => {
            const c = clubById(v, h.clubId);
            return (
              <div key={h.season} class="list-row">
                {c && <Crest spec={c.crest} colors={c.colors} name={c.name} short={c.short} size={30} />}
                <div class="lr-main">
                  <div class="lr-title">{c?.name ?? 'מועדון'}</div>
                  <div class="lr-sub">
                    {h.year} · {countHe(h.apps, 'הופעה', 'הופעות', true)} · {countHe(h.goals, 'שער', 'שערים')} · מקום {h.position}
                  </div>
                </div>
                <span class="rating-pill r-mid num">{h.avgRating.toFixed(1)}</span>
              </div>
            );
          })}
        </section>
      )}

      {/* off-screen sources for the canvas */}
      <div class="offscreen" aria-hidden="true">
        <div ref={shirtRef}>
          <Shirt name="" number={v.player.shirt} colors={colors} pattern={patternFor(v.club?.crest[1] ?? 0)} noText />
        </div>
        <div ref={crestRef}>
          {clubs.map((c, i) => (
            <Crest key={`${c.id}-${i}`} spec={c.crest} colors={c.colors} name={c.name} short={c.short} size={120} />
          ))}
        </div>
      </div>

      <div class="action-bar">
        <button class="btn" type="button" onClick={download} disabled={!url}>
          <IconDownload size={20} /> שמור
        </button>
        <button class="btn btn-primary grow2" type="button" onClick={share} disabled={!blob}>
          <IconShare size={20} /> שתף את הקריירה
        </button>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" onClick={() => navigate('new')}>
        קריירה חדשה: עמדה אחרת, התחלה אחרת
      </button>
    </main>
  );
}
