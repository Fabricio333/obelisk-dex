'use client';

import { useSyncExternalStore } from 'react';

export interface Preferences {
  showActivityIndicator: boolean;
}

const DEFAULTS: Preferences = {
  showActivityIndicator: true,
};

const STORAGE_KEY = 'obelisk:preferences';

let current: Preferences = load();
const listeners = new Set<() => void>();

function load(): Preferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ignore quota/unavailable */
  }
}

export function getPreferences(): Preferences {
  return current;
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  persist();
  listeners.forEach((l) => l());
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => DEFAULTS,
  );
}
