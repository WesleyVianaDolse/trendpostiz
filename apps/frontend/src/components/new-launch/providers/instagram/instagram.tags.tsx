'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { ReactTags } from 'react-tag-autocomplete';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const normalizeInstagramUsername = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@+/, '')
    .split(/[/?#]/)[0]
    .trim();

export const InstagramCollaboratorsTags: FC<{
  name: string;
  label: string;
  onChange: (event: {
    target: {
      value: any[];
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name, label } = props;
  const { getValues } = useSettings();
  const [tagValue, setTagValue] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<string>('');
  const t = useT();

  const onDelete = useCallback(
    (tagIndex: number) => {
      const modify = tagValue.filter((_, i) => i !== tagIndex);
      setTagValue(modify);
      onChange({
        target: {
          value: modify,
          name,
        },
      });
    },
    [name, onChange, tagValue]
  );
  const onAddition = useCallback(
    (newTag: any) => {
      if (tagValue.length >= 3) {
        return;
      }
      const label = normalizeInstagramUsername(
        newTag.label || newTag.value || ''
      );
      if (!label || tagValue.some((tag) => tag.label === label)) {
        return;
      }
      const modify = [...tagValue, { ...newTag, label, value: label }];
      setTagValue(modify);
      onChange({
        target: {
          value: modify,
          name,
        },
      });
    },
    [name, onChange, tagValue]
  );
  useEffect(() => {
    const settings = getValues()[props.name];
    if (settings) {
      setTagValue(
        settings
          .map((tag: any) => {
            const label = normalizeInstagramUsername(
              tag.label || tag.value || ''
            );
            return label ? { ...tag, label, value: label } : false;
          })
          .filter(Boolean)
      );
    }
  }, [getValues, props.name]);
  const suggestionsArray = useMemo(() => {
    const label = normalizeInstagramUsername(suggestions);
    return [
      ...tagValue,
      {
        label,
        value: label,
      },
    ].filter((f) => f.label);
  }, [suggestions, tagValue]);
  return (
    <div>
      <div>
        <div className={clsx(`text-[14px] mb-[6px]`)}>{label}</div>
        <ReactTags
          placeholderText={t('add_a_tag', 'Add a tag')}
          suggestions={suggestionsArray}
          selected={tagValue}
          onAdd={onAddition}
          onInput={setSuggestions}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
};
