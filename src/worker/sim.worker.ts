// Web Worker: owns the World, exposes the core API through Comlink.
import * as Comlink from 'comlink';
import type { ApplyResult, Command, View, World } from '../core/types';
import type { Content } from '../core/content';
import { normalizeContent } from '../core/contentLoad';
import { apply as coreApply, buildView, newGame } from '../core/game';
import { compileEvents } from '../core/events';
import { deserialize, serialize as serializeWorld } from '../core/save';
import leagues from '../content/leagues.json';
import names from '../content/names.json';
import wages from '../content/wages.json';
import themes from '../content/themes.json';
import events from '../content/events.json';

const content: Content = normalizeContent({ leagues, names, wages, themes, events });
compileEvents(content);

let world: World | null = null;

/** Every command changes the world (plan, event answers, match moments, negotiation rounds, settings): the UI saves after each one,
 *  so a reload resumes in exactly the same phase and an event cannot be re-rolled. */
const NO_SAVE: Command['type'][] = [];

function result(saveDue: boolean, toast?: string[]): ApplyResult {
  if (!world) throw new Error('no world');
  return { view: buildView(world), saveDue, ...(toast && toast.length ? { toast } : {}) };
}

const api = {
  newCareer(cmd: Extract<Command, { type: 'newCareer' }>): ApplyResult {
    world = newGame(cmd, content);
    return result(true, world.career.startStory ? [world.career.startStory] : undefined);
  },
  apply(cmd: Command): ApplyResult {
    if (cmd.type === 'newCareer') return api.newCareer(cmd);
    if (!world) throw new Error('no career loaded');
    const out = coreApply(world, cmd, content);
    world = out.world;
    return result(!NO_SAVE.includes(cmd.type), out.toast);
  },
  load(json: string): ApplyResult {
    world = deserialize(json);
    return result(false);
  },
  export(): string {
    if (!world) throw new Error('no career loaded');
    return serializeWorld(world);
  },
  serialize(): string {
    return api.export();
  },
  view(): View | null {
    return world ? buildView(world) : null;
  },
};

export type SimApi = typeof api;
Comlink.expose(api);
