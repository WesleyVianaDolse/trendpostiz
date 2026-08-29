'use client';

import {
  getProviderRule,
} from '@gitroom/frontend/features/publisher/model/provider-rules';
import {
  PublisherIntegration,
  PublisherProviderSettings,
} from '@gitroom/frontend/features/publisher/model/publisher.types';

interface ProviderSettingsProps {
  integrations: PublisherIntegration[];
  settingsByIntegration: Record<string, PublisherProviderSettings>;
  onChange: (
    integrationId: string,
    key: string,
    value: string
  ) => void;
  validationError?: string;
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
    return Boolean(rule.fields?.length || defaultsDescription(integration.identifier));
  });

  if (!configurable.length) return null;

  return (
    <section aria-labelledby="publisher-provider-settings-title">
      <div className="mb-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-btnPrimary">Configurações</p>
        <h2 id="publisher-provider-settings-title" className="mt-1 text-lg font-bold text-newTextColor">
          Detalhes por rede
        </h2>
      </div>

      <div className="space-y-3">
        {configurable.map((integration) => {
          const rule = getProviderRule(integration.identifier);
          const description = defaultsDescription(integration.identifier);
          return (
            <div key={integration.id} className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-4">
              <div className="mb-3 flex items-center gap-2">
                {integration.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={integration.picture} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-newTextColor">{integration.name}</p>
                  <p className="text-[11px] text-textItemBlur">{integration.display || integration.identifier}</p>
                </div>
              </div>

              {description ? <p className="text-xs leading-5 text-textItemBlur">{description}</p> : null}

              {rule.fields?.map((field) => (
                <label key={field.key} className="mt-3 block text-xs font-semibold text-newTextColor">
                  {field.label}
                  {field.type === 'select' ? (
                    <select
                      value={String(settingsByIntegration[integration.id]?.[field.key] || '')}
                      onChange={(event) => onChange(integration.id, field.key, event.target.value)}
                      className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-3 text-sm text-newTextColor outline-none focus:border-btnPrimary"
                    >
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={String(settingsByIntegration[integration.id]?.[field.key] || '')}
                      onChange={(event) => onChange(integration.id, field.key, event.target.value)}
                      placeholder={field.placeholder}
                      className="mt-2 min-h-12 w-full rounded-xl border border-newTableBorder bg-newTableHeader px-3 text-sm text-newTextColor outline-none placeholder:text-textItemBlur focus:border-btnPrimary"
                    />
                  )}
                </label>
              ))}
            </div>
          );
        })}
      </div>

      {validationError ? <p className="mt-2 text-xs font-medium text-red-500">{validationError}</p> : null}
    </section>
  );
}
