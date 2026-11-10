import { act, renderHook } from '@testing-library/react';
import { vi, test, expect, beforeEach, afterEach } from 'vitest';
import { useRefreshOnVisible } from '../use-refresh-on-visible';

// revue finale 2b-3 m-2 : un seul écouteur de retour sur l'onglet pour tous les écrans

function visibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('retour sur l\'onglet : le rappel est appelé ; onglet masqué : aucun appel', () => {
  const refresh = vi.fn();
  renderHook(() => useRefreshOnVisible(refresh));
  act(() => visibility('hidden'));
  expect(refresh).not.toHaveBeenCalled();
  act(() => visibility('visible'));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('intervalle minimal : un second retour trop proche est ignoré, un retour après l\'intervalle est pris', () => {
  const refresh = vi.fn();
  renderHook(() => useRefreshOnVisible(refresh, { minIntervalMs: 5000 }));
  act(() => visibility('visible'));
  vi.setSystemTime(new Date('2026-11-09T10:00:04Z'));
  act(() => visibility('visible'));
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date('2026-11-09T10:00:05Z'));
  act(() => visibility('visible'));
  expect(refresh).toHaveBeenCalledTimes(2);
});

test('intervalle par défaut : 5 secondes', () => {
  const refresh = vi.fn();
  renderHook(() => useRefreshOnVisible(refresh));
  act(() => visibility('visible'));
  vi.setSystemTime(new Date('2026-11-09T10:00:03Z'));
  act(() => visibility('visible'));
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date('2026-11-09T10:00:06Z'));
  act(() => visibility('visible'));
  expect(refresh).toHaveBeenCalledTimes(2);
});

test('le dernier rappel fourni est celui qui est appelé, sans se réabonner', () => {
  const add = vi.spyOn(document, 'addEventListener');
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = renderHook(({ cb }) => useRefreshOnVisible(cb), { initialProps: { cb: first } });
  rerender({ cb: second });
  act(() => visibility('visible'));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
});

test('démontage : l\'écouteur est retiré', () => {
  const refresh = vi.fn();
  const { unmount } = renderHook(() => useRefreshOnVisible(refresh));
  unmount();
  act(() => visibility('visible'));
  expect(refresh).not.toHaveBeenCalled();
});

// guillemets simples, doubles ou gabarit, espaces et retours à la ligne permis, et l'affectation `onvisibilitychange`
const LISTENER = /addEventListener\(\s*['"`]visibilitychange['"`]|\bonvisibilitychange\s*=/;

// revue finale 2b-3 m-2 : la garde reconnaît toutes les écritures de l'écouteur
test('la garde repère les écritures à guillemets doubles, en gabarit, sur plusieurs lignes ou par affectation', () => {
  expect(LISTENER.test("document.addEventListener('visibilitychange', f)")).toBe(true);
  expect(LISTENER.test('document.addEventListener("visibilitychange", f)')).toBe(true);
  expect(LISTENER.test('document.addEventListener(`visibilitychange`, f)')).toBe(true);
  expect(LISTENER.test("document.addEventListener(\n  'visibilitychange', f)")).toBe(true);
  expect(LISTENER.test('document.onvisibilitychange = f')).toBe(true);
  expect(LISTENER.test("document.addEventListener('focus', f)")).toBe(false);
});

// revue finale 2b-3 m-2 : une seule copie de l'écouteur ; la vérification de l'organisation de la session (focus et
// visibilité, sans relecture de données) est le seul autre abonné.
test('aucun écran ne pose son propre écouteur visibilitychange (guillemets simples, doubles, gabarit)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(__dirname, '../..');
  const allowed = ['lib/use-refresh-on-visible.ts', 'components/providers/session-provider.tsx'];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (/\.tsx?$/.test(entry.name) && LISTENER.test(fs.readFileSync(full, 'utf8'))) {
        found.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  expect(found.sort()).toEqual([...allowed].sort());
});
