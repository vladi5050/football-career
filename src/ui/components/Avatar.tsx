import type { Role } from '../../core/types';
import { initials } from '../i18n';

const ROLE_COLOR: Record<Role | 'rival', string> = {
  player: '#1E4FD8', coach: '#D7263D', agent: '#2F9E57', journalist: '#6F7A8F', chairman: '#1B2A4A', family: '#E3B23C', rival: '#A11B2E',
};
export function Avatar({ name, role = 'player', size, rival }: { name: string; role?: Role; size?: 'sm' | 'lg'; rival?: boolean }) {
  return (
    <span class={`avatar ${size ?? ''}`} style={{ '--av': ROLE_COLOR[rival ? 'rival' : role] }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
