// Pseudo-3D broadcast camera (no Pixi). A level pinhole camera placed high behind the action:
// vertical objects stay vertical, the grass is foreshortened. `dir` = -1 looks toward the goal
// (decreasing z, the attacking view), +1 looks out of the goal (keeper / defending view).
import { lerp } from './sim';

export interface Cam { x: number; z: number; h: number; f: number; hy: number; dir: -1 | 1 }
export interface Screen { w: number; h: number }
export interface Proj { sx: number; sy: number; k: number; d: number }

export function project(c: Cam, s: Screen, x: number, z: number, h: number): Proj {
  const d = Math.max(0.5, (z - c.z) * c.dir);
  const k = c.f / d;
  const lat = (x - c.x) * -c.dir;
  return { sx: s.w / 2 + lat * k, sy: c.hy + (c.h - h) * k, k, d };
}

/** Screen point -> ground point (h = 0). Returns null above the horizon. */
export function unproject(c: Cam, s: Screen, sx: number, sy: number): { x: number; z: number } | null {
  const dy = sy - c.hy;
  if (dy <= 1) return null;
  const d = (c.h * c.f) / dy;
  const lat = ((sx - s.w / 2) * d) / c.f;
  return { x: c.x + lat * -c.dir, z: c.z + d * c.dir };
}

/**
 * Frame a shot: ground point zFar lands on screen y = yFar, zNear on yNear (fractions of height),
 * with the camera `back` metres behind zNear (bigger = flatter perspective) at height camH.
 */
export function frameCam(s: Screen, opt: { x: number; zFar: number; zNear: number; yFar: number; yNear: number; back: number; camH: number; dir: -1 | 1 }): Cam {
  const { dir } = opt;
  const cz = opt.zNear - dir * opt.back;
  const dNear = opt.back;
  const dFar = Math.abs(opt.zFar - cz);
  const f = ((opt.yNear - opt.yFar) * s.h) / (opt.camH * (1 / dNear - 1 / dFar));
  const hy = opt.yNear * s.h - (opt.camH * f) / dNear;
  return { x: opt.x, z: cz, h: opt.camH, f, hy, dir };
}

export function lerpCam(a: Cam, b: Cam, u: number): Cam {
  return { x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), h: lerp(a.h, b.h, u), f: lerp(a.f, b.f, u), hy: lerp(a.hy, b.hy, u), dir: b.dir };
}

/** Zoom about the screen centre-ish (focus y) by scaling focal length and keeping focusY fixed. */
export function zoomCam(c: Cam, s: Screen, zoom: number, focusY = 0.55): Cam {
  const fy = focusY * s.h;
  return { ...c, f: c.f * zoom, hy: fy - (fy - c.hy) * zoom };
}
