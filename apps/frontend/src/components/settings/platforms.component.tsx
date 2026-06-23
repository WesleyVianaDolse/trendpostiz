'use client';

import React from 'react';
import useSWR from 'swr';
import Image from 'next/image';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  getPlatformDisplayName,
  usePlatformVisibilitySettings,
} from '@gitroom/frontend/components/platforms/platform.visibility';

type PlatformItem = {
  identifier: string;
  name: string;
};

const iconFor = (identifier: string) =>
  identifier === 'youtube'
    ? '/icons/platforms/youtube.svg'
    : `/icons/platforms/${identifier}.png`;

export const PlatformsComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const { isEnabled, setPlatformEnabled } = usePlatformVisibilitySettings();
  const { data, isLoading } = useSWR(
    'settings-platforms-list',
    async () => (await (await fetch('/integrations')).json()).social as PlatformItem[],
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('platforms', 'Platforms')}</h3>
      <div className="text-[13px] text-customColor18 mt-[6px]">
        {t(
          'platforms_visibility_description',
          'Choose which platforms appear in Add Channel. Existing connected channels are not changed.'
        )}
      </div>

      <div className="my-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[14px]">
        {isLoading && (
          <div className="animate-pulse">{t('loading', 'Loading...')}</div>
        )}

        {!isLoading &&
          data?.map((platform) => {
            const enabled = isEnabled(platform.identifier);
            return (
              <div
                key={platform.identifier}
                className="flex items-center justify-between gap-[20px] rounded-[8px] bg-newTableHeader p-[14px]"
              >
                <div className="flex items-center gap-[12px] min-w-0">
                  <Image
                    src={iconFor(platform.identifier)}
                    alt=""
                    width={32}
                    height={32}
                    className="h-[32px] w-[32px] object-contain"
                  />
                  <div className="min-w-0">
                    <div className="text-[14px] whitespace-pre-wrap">
                      {getPlatformDisplayName(
                        platform.identifier,
                        platform.name
                      )}
                    </div>
                    <div className="text-[12px] text-customColor18">
                      {enabled
                        ? t('visible_in_add_channel', 'Visible in Add Channel')
                        : t('hidden_from_add_channel', 'Hidden from Add Channel')}
                    </div>
                  </div>
                </div>
                <Checkbox
                  disableForm
                  checked={enabled}
                  name={platform.identifier}
                  onChange={(event) =>
                    setPlatformEnabled(platform.identifier, event.target.value)
                  }
                />
              </div>
            );
          })}
      </div>
    </div>
  );
};
