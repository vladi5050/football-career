import { ratingClass, ratingWord } from '../i18n';

export function Stars({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span class="stars" role="img" aria-label={`${value} מתוך ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} viewBox="0 0 20 20" class={i < Math.round(value) ? '' : 'off'} aria-hidden="true">
          <path d="M10 1.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L1.4 7.8l6-.7z" fill="currentColor" />
        </svg>
      ))}
    </span>
  );
}

export function RatingPill({ value }: { value: number }) {
  return <span class={`rating-pill ${ratingClass(value)}`}><span class="num">{value.toFixed(1)}</span></span>;
}

/** Rubber stamp with the match rating. */
export function RatingStamp({ value, animate = true }: { value: number; animate?: boolean }) {
  const color = value >= 7.2 ? 'green' : value >= 5.8 ? 'blue' : '';
  const word = ratingWord(value);
  return (
    <span class={`stamp ${color} ${animate ? 'animate' : ''}`} role="img" aria-label={`ציון ${value.toFixed(1)}`}>
      <span>
        <span class="stamp-big num">{value.toFixed(1)}</span>
        <br />
        <span class="stamp-small">{word}</span>
      </span>
    </span>
  );
}
