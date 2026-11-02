import { render } from 'preact';
import '../ui/styles/tokens.css';
import '../ui/styles/base.css';
import '../ui/styles/components.css';
import '../ui/styles/anim.css';
import '../ui/styles/screens.css';
import '../ui/styles/phone.css';
import '../ui/styles/responsive.css';
import { App } from '../ui/App';
import { hasSave, navigate, screen, setSimApi, view, type SimApi } from './store';
import { autosave } from './save';
import { createMockSim } from './mockSim';

declare global {
  interface Window {
    /** Set by the real worker glue (or tests) before boot to replace the mock. */
    __SIM__?: SimApi;
  }
}

async function boot(): Promise<void> {
  // Real simulation if provided, otherwise the mock so every screen renders.
  const realLoader = Object.values(import.meta.glob('./sim.{ts,tsx}'))[0];
  let api: SimApi | null = window.__SIM__ ?? null;
  if (!api && realLoader && !new URLSearchParams(location.search).has('mock')) {
    try {
      const mod = (await realLoader()) as { createSimApi?: () => SimApi | Promise<SimApi> };
      if (mod.createSimApi) api = await mod.createSimApi();
    } catch (e) {
      console.warn('real sim failed to start, using mock', e);
    }
  }
  setSimApi(api ?? createMockSim());

  hasSave.value = await autosave.exists();
  // Without a loaded career, any in-game hash route falls back to the title screen.
  if (!view.value && !['title', 'new', 'editor', 'settings'].includes(screen.value)) navigate('title', { replace: true });

  render(<App />, document.getElementById('app')!);
}

void boot();
