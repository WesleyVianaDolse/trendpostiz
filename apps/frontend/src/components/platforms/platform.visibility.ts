'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type PlatformVisibility = Record<string, boolean>;

export const platformVisibilityStorageKey = 'trendpostiz-platform-visibility';
export const platformVisibilityEvent = 'trendpostiz-platform-visibility-change';

export const defaultEnabledPlatformIdentifiers = [
  'tiktok',
  'facebook',
  'instagram',
  'youtube',
  'gmb',
];

const defaultEnabledSet = new Set(defaultEnabledPlatformIdentifiers);
const platformOrder = new Map(
  defaultEnabledPlatformIdentifiers.map((identifier, index) => [
    identifier,
    index,
  ])
);
const platformDisplayNames: Record<string, string> = {
  tiktok: 'TikTok',
};

export function getPlatformDisplayName(identifier: string, fallback: string) {
  return platformDisplayNames[identifier] ?? fallback;
}

export function comparePlatforms(
  a: { identifier: string; name: string },
  b: { identifier: string; name: string }
) {
  const aOrder = platformOrder.get(a.identifier) ?? 1000;
  const bOrder = platformOrder.get(b.identifier) ?? 1000;

  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  return getPlatformDisplayName(a.identifier, a.name).localeCompare(
    getPlatformDisplayName(b.identifier, b.name)
  );
}

export function isPlatformEnabled(
  identifier: string,
  settings: PlatformVisibility
) {
  return settings[identifier] ?? defaultEnabledSet.has(identifier);
}

export function readPlatformVisibilitySettings(): PlatformVisibility {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(platformVisibilityStorageKey);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function writePlatformVisibilitySettings(settings: PlatformVisibility) {
  window.localStorage.setItem(
    platformVisibilityStorageKey,
    JSON.stringify(settings)
  );
  window.dispatchEvent(new Event(platformVisibilityEvent));
}

export function usePlatformVisibilitySettings() {
  const [settings, setSettings] = useState<PlatformVisibility>({});

  const reload = useCallback(() => {
    setSettings(readPlatformVisibilitySettings());
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener('storage', reload);
    window.addEventListener(platformVisibilityEvent, reload);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener(platformVisibilityEvent, reload);
    };
  }, [reload]);

  const setPlatformEnabled = useCallback(
    (identifier: string, enabled: boolean) => {
      const next = {
        ...readPlatformVisibilitySettings(),
        [identifier]: enabled,
      };
      writePlatformVisibilitySettings(next);
      setSettings(next);
    },
    []
  );

  return useMemo(
    () => ({
      settings,
      isEnabled: (identifier: string) =>
        isPlatformEnabled(identifier, settings),
      setPlatformEnabled,
    }),
    [settings, setPlatformEnabled]
  );
}
