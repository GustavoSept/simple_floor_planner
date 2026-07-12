import { BehaviorSubject } from 'rxjs';
import type { Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const KEY = 'sfp.settings';

export class SettingsStore {
  readonly settings$: BehaviorSubject<Settings>;

  constructor() {
    let s = DEFAULT_SETTINGS;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      /* corrupted or unavailable storage — use defaults */
    }
    this.settings$ = new BehaviorSubject<Settings>(s);
  }

  get value(): Settings {
    return this.settings$.value;
  }

  update(patch: Partial<Settings>): void {
    const next = { ...this.settings$.value, ...patch };
    this.settings$.next(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage full/unavailable — settings just won't persist */
    }
  }
}
