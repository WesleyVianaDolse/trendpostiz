'use client';

import { useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { getProviderRule } from '@gitroom/frontend/features/publisher/model/provider-rules';
import {
  PublisherIntegration,
  PublisherProviderSettings,
} from '@gitroom/frontend/features/publisher/model/publisher.types';

interface ProviderSettingsProps {
  integrations: PublisherIntegration[];
  settingsByIntegration: Record<string, PublisherProviderSettings>;
  onChange: (integrationId: string, key: string, value: unknown) => void;
  validationError?: string;
}

type TikTokPrivacy =
  | 'PUBLIC_TO_EVERYONE'
  | 'MUTUAL_FOLLOW_FRIENDS'
  | 'FOLLOWER_OF_CREATOR'
  | 'SELF_ONLY';

interface TikTokCreatorInfo {
  creator_nickname: string;
  creator_username: string;
  privacy_level_options: TikTokPrivacy[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

const privacyLabels: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: 'Público',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos que se seguem',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Somente eu',
};

function TikTokSettings({
  integration,
  settings,
  onChange,
}: {
  integration: PublisherIntegration;
  settings: PublisherProviderSettings;
  onChange: ProviderSettingsProps['onChange'];
}) {
  const fetch = useFetch();
  const method = String(settings.content_posting_method || 'UPLOAD');
  const directPost = method === 'DIRECT_POST';
  const loadCreatorInfo = useCallback(async () => {
    const response = await fetch('/integrations/function', {
      method: 'POST',
      body: JSON.stringify({
        name: 'creatorInfo',
        id: integration.id,
      }),
    });
    if (!response.ok) throw new Error('Falha ao consultar o TikTok.');
    const result = (await response.json()) as TikTokCreatorInfo | false;
    if (!result)
      throw new Error('O TikTok não retornou as configurações da conta.');
    return result;
  }, [fetch, integration.id]);
  const { data, error, isLoading } = useSWR<TikTokCreatorInfo>(
    directPost ? `publisher-tiktok-creator-info-${integration.id}` : null,
    loadCreatorInfo,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  useEffect(() => {
    if (!directPost || !data) return;
    onChange(integration.id, 'creator_info_loaded', true);
    onChange(
      integration.id,
      'max_video_post_duration_sec',
      data.max_video_post_duration_sec
    );
    if (
      settings.privacy_level &&
      !data.privacy_level_options.includes(
        settings.privacy_level as TikTokPrivacy
      )
    ) {
      onChange(integration.id, 'privacy_level', '');
    }
    if (data.comment_disabled) onChange(integration.id, 'comment', false);
    if (data.duet_disabled) onChange(integration.id, 'duet', false);
    if (data.stitch_disabled) onChange(integration.id, 'stitch', false);
  }, [data, directPost, integration.id, onChange, settings.privacy_level]);

  const checkbox = (key: string, label: string, disabled = false) => (
    <label
      className={`flex min-h-11 items-center gap-3 text-sm ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={Boolean(settings[key])}
        disabled={disabled}
        onChange={(event) =>
          onChange(integration.id, key, event.target.checked)
        }
        className="h-5 w-5 accent-btnPrimary"
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-4">
      <label className="block text-xs font-semibold text-newTextColor">
        Como enviar ao TikTok
        <select
          value={method}
          onChange={(event) => {
            const value = event.target.value;
            onChange(integration.id, 'content_posting_method', value);
            onChange(integration.id, 'direct_post_consent', false);
            if (value === 'UPLOAD') {
              onChange(integration.id, 'creator_info_loaded', false);
              onChange(integration.id, 'privacy_level', '');
            }
          }}
          className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-3 text-sm text-newTextColor outline-none focus:border-btnPrimary"
        >
          <option value="UPLOAD">Enviar para finalizar no app TikTok</option>
          <option value="DIRECT_POST">Publicar diretamente</option>
        </select>
      </label>

      {method === 'UPLOAD' ? (
        <p className="rounded-xl bg-btnPrimary/10 p-3 text-xs leading-5 text-textItemBlur">
          O arquivo será enviado para a caixa de entrada do TikTok. Abra o app
          para revisar e concluir a publicação.
        </p>
      ) : (
        <div className="space-y-3 rounded-xl border border-newTableBorder p-3">
          {isLoading ? (
            <p className="text-xs text-textItemBlur">
              Consultando as permissões da conta…
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-red-500">
              Não foi possível consultar o TikTok. Troque para envio pelo app ou
              tente novamente.
            </p>
          ) : null}
          {data ? (
            <>
              <p className="text-xs text-textItemBlur">
                Publicando em {data.creator_nickname} (@{data.creator_username}
                ). Vídeos: até {data.max_video_post_duration_sec}s.
              </p>
              <label className="block text-xs font-semibold text-newTextColor">
                Quem pode ver
                <select
                  value={String(settings.privacy_level || '')}
                  onChange={(event) =>
                    onChange(
                      integration.id,
                      'privacy_level',
                      event.target.value
                    )
                  }
                  className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-3 text-sm text-newTextColor outline-none focus:border-btnPrimary"
                >
                  <option value="">Selecione</option>
                  {data.privacy_level_options.map((privacy) => (
                    <option key={privacy} value={privacy}>
                      {privacyLabels[privacy]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-x-3">
                {checkbox(
                  'comment',
                  'Permitir comentários',
                  data.comment_disabled
                )}
                {checkbox('duet', 'Permitir Dueto', data.duet_disabled)}
                {checkbox('stitch', 'Permitir Costura', data.stitch_disabled)}
              </div>
              {checkbox(
                'direct_post_consent',
                'Autorizo o envio direto deste conteúdo ao TikTok'
              )}
            </>
          ) : null}
        </div>
      )}

      <label className="block text-xs font-semibold text-newTextColor">
        Adicionar música automaticamente (fotos)
        <select
          value={String(settings.autoAddMusic || 'no')}
          onChange={(event) =>
            onChange(integration.id, 'autoAddMusic', event.target.value)
          }
          className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-3 text-sm text-newTextColor outline-none focus:border-btnPrimary"
        >
          <option value="no">Não</option>
          <option value="yes">Sim</option>
        </select>
      </label>

      {checkbox('video_made_with_ai', 'Conteúdo criado ou alterado com IA')}
      {checkbox('disclose', 'Este conteúdo promove uma marca ou serviço')}
      {settings.disclose ? (
        <div className="ml-3 border-l-2 border-newTableBorder pl-3">
          {checkbox('brand_organic_toggle', 'Minha marca')}
          {checkbox('brand_content_toggle', 'Conteúdo de outra marca')}
        </div>
      ) : null}
    </div>
  );
}

function defaultsDescription(identifier: string) {
  if (identifier === 'gmb') return 'Atualização padrão, sem chamada para ação.';
  if (identifier === 'mewe') return 'Publicação na sua timeline.';
  return '';
}

export function ProviderSettings({
  integrations,
  settingsByIntegration,
  onChange,
  validationError,
}: ProviderSettingsProps) {
  const configurable = integrations.filter((integration) => {
    const rule = getProviderRule(integration.identifier);
    return Boolean(
      integration.identifier === 'tiktok' ||
        rule.fields?.length ||
        defaultsDescription(integration.identifier)
    );
  });

  if (!configurable.length) return null;

  return (
    <section aria-labelledby="publisher-provider-settings-title">
      <div className="mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-btnPrimary">
          Configurações
        </p>
        <h2
          id="publisher-provider-settings-title"
          className="mt-1 text-lg font-bold text-newTextColor"
        >
          Detalhes por rede
        </h2>
      </div>

      <div className="space-y-3">
        {configurable.map((integration) => {
          const rule = getProviderRule(integration.identifier);
          const description = defaultsDescription(integration.identifier);
          return (
            <div
              key={integration.id}
              className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                {integration.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={integration.picture}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-newTextColor">
                    {integration.name}
                  </p>
                  <p className="text-[11px] text-textItemBlur">
                    {integration.display || integration.identifier}
                  </p>
                </div>
              </div>

              {description ? (
                <p className="text-xs leading-5 text-textItemBlur">
                  {description}
                </p>
              ) : null}

              {integration.identifier === 'tiktok' ? (
                <TikTokSettings
                  integration={integration}
                  settings={settingsByIntegration[integration.id] || {}}
                  onChange={onChange}
                />
              ) : null}

              {integration.identifier !== 'tiktok'
                ? rule.fields?.map((field) => (
                    <label
                      key={field.key}
                      className="mt-3 block text-xs font-semibold text-newTextColor"
                    >
                      {field.label}
                      {field.type === 'select' ? (
                        <select
                          value={String(
                            settingsByIntegration[integration.id]?.[
                              field.key
                            ] || ''
                          )}
                          onChange={(event) =>
                            onChange(
                              integration.id,
                              field.key,
                              event.target.value
                            )
                          }
                          className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-3 text-sm text-newTextColor outline-none focus:border-btnPrimary"
                        >
                          {field.options?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={String(
                            settingsByIntegration[integration.id]?.[
                              field.key
                            ] || ''
                          )}
                          onChange={(event) =>
                            onChange(
                              integration.id,
                              field.key,
                              event.target.value
                            )
                          }
                          placeholder={field.placeholder}
                          className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-3 text-sm text-newTextColor outline-none placeholder:text-textItemBlur focus:border-btnPrimary"
                        />
                      )}
                    </label>
                  ))
                : null}
            </div>
          );
        })}
      </div>

      {validationError ? (
        <p className="mt-2 text-xs font-medium text-red-500">
          {validationError}
        </p>
      ) : null}
    </section>
  );
}
