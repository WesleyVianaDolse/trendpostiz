'use client';

import useSWR from 'swr';
import { useCallback, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'unknown';

const versionFetcher = async (url: string) => {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to check application version.');
  return (await response.json()) as { version: string };
};

export const useApplicationVersion = () => {
  const version = useSWR('/app-version', versionFetcher, {
    refreshInterval: 5 * 60 * 1000,
    revalidateOnFocus: true,
    refreshWhenHidden: false,
    shouldRetryOnError: true,
  });
  return {
    currentVersion: CURRENT_VERSION,
    latestVersion: version.data?.version,
    hasUpdate:
      !!version.data?.version &&
      version.data.version !== 'unknown' &&
      version.data.version !== CURRENT_VERSION,
  };
};

const activateLatestVersion = async (version: string) => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister())
    );
  }
  if ('caches' in window) {
    await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  }

  const url = new URL(window.location.href);
  url.searchParams.set('__version', version);
  window.location.replace(url.toString());
};

export const ApplicationVersion = () => {
  const t = useT();
  const { currentVersion, latestVersion, hasUpdate } = useApplicationVersion();
  const [updating, setUpdating] = useState(false);
  const update = useCallback(async () => {
    if (!latestVersion || updating) return;
    setUpdating(true);
    await activateLatestVersion(latestVersion);
  }, [latestVersion, updating]);

  return (
    <div className="mt-[24px] rounded-[8px] border border-newSettings bg-newBgColorInner p-[20px] flex items-center justify-between gap-[16px]">
      <div>
        <div className="text-[16px]">
          {t('application_version', 'Application version')}
        </div>
        <div className="text-[13px] text-textColor opacity-70">
          {currentVersion}
        </div>
      </div>
      {hasUpdate && (
        <button
          type="button"
          disabled={updating}
          onClick={update}
          className="rounded-[6px] bg-newSettings px-[16px] py-[10px] text-white disabled:opacity-60"
        >
          {updating
            ? t('updating_version', 'Updating…')
            : t('update_to_version', `Update to ${latestVersion}`)}
        </button>
      )}
    </div>
  );
};

export const VersionUpdateNotifier = () => {
  const t = useT();
  const { latestVersion, hasUpdate } = useApplicationVersion();
  const [updating, setUpdating] = useState(false);
  const update = useCallback(async () => {
    if (!latestVersion || updating) return;
    setUpdating(true);
    await activateLatestVersion(latestVersion);
  }, [latestVersion, updating]);

  if (!hasUpdate) return null;

  return (
    <div className="fixed left-1/2 top-[16px] z-[10000] flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-[14px] rounded-[8px] border border-newSettings bg-newBgColorInner px-[18px] py-[12px] shadow-lg">
      <div className="text-[14px]">
        {t('new_version_available', 'A new version is available.')}
      </div>
      <button
        type="button"
        disabled={updating}
        onClick={update}
        className="whitespace-nowrap rounded-[6px] bg-newSettings px-[14px] py-[8px] text-[13px] text-white disabled:opacity-60"
      >
        {updating
          ? t('updating_version', 'Updating…')
          : t('update_now', 'Update now')}
      </button>
    </div>
  );
};
