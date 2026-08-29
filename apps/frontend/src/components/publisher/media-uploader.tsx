'use client';

import { ChangeEvent, useEffect, useRef } from 'react';
import { PublisherMedia } from '@gitroom/frontend/features/publisher/model/publisher.types';
import { usePublisherUploader } from '@gitroom/frontend/features/publisher/media/use-publisher-uploader';

interface MediaUploaderProps {
  onChange: (media: PublisherMedia[]) => void;
  onStatusChange: (status: { uploading: boolean; hasErrors: boolean }) => void;
  validationError?: string;
}

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function MediaUploader({
  onChange,
  onStatusChange,
  validationError,
}: MediaUploaderProps) {
  const input = useRef<HTMLInputElement>(null);
  const uploader = usePublisherUploader();

  useEffect(() => {
    onChange(uploader.media);
  }, [onChange, uploader.media]);

  useEffect(() => {
    onStatusChange({
      uploading: uploader.isUploading,
      hasErrors: uploader.hasErrors,
    });
  }, [onStatusChange, uploader.hasErrors, uploader.isUploading]);

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) uploader.addFiles(event.target.files);
    event.target.value = '';
  };

  return (
    <section aria-labelledby="publisher-media-title">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-btnPrimary">Etapa 3</p>
      <h2 id="publisher-media-title" className="mt-1 text-lg font-bold text-newTextColor">Adicione mídia</h2>
      <p className="mt-1 text-sm leading-5 text-textItemBlur">JPEG, PNG, GIF ou WebP até 30 MB. MP4 ou MOV até 1 GB.</p>

      <input
        ref={input}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime"
        onChange={selectFiles}
        className="sr-only"
      />
      <button
        type="button"
        disabled={!uploader.ready}
        onClick={() => input.current?.click()}
        className="mt-3 flex min-h-14 w-full items-center justify-center rounded-2xl border border-dashed border-btnPrimary bg-btnPrimary/10 px-4 text-sm font-bold text-btnPrimary disabled:opacity-50"
      >
        + Adicionar foto ou vídeo
      </button>

      {uploader.selectionError ? (
        <p className="mt-2 rounded-xl bg-red-500/10 p-3 text-xs leading-5 text-red-500" role="alert">
          {uploader.selectionError}
        </p>
      ) : null}

      {uploader.items.length ? (
        <div className="mt-3 space-y-3">
          {uploader.items.map((item) => (
            <article key={item.id} className="overflow-hidden rounded-2xl border border-newTableBorder bg-newBgColorInner p-3">
              <div className="flex gap-3">
                {item.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt="Preview da mídia selecionada" className="h-16 w-16 shrink-0 rounded-xl bg-newTableHeader object-cover" />
                ) : (
                  <video src={item.previewUrl} className="h-16 w-16 shrink-0 rounded-xl bg-black object-cover" muted playsInline />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-newTextColor">{item.name}</p>
                  <p className="mt-0.5 text-[11px] text-textItemBlur">{formatSize(item.size)}</p>
                  <p className={`mt-1 text-xs font-semibold ${item.status === 'error' ? 'text-red-500' : item.status === 'completed' ? 'text-emerald-500' : 'text-btnPrimary'}`}>
                    {item.status === 'selected'
                      ? 'Preparando upload...'
                      : item.status === 'uploading'
                      ? `Enviando... ${item.progress}%`
                      : item.status === 'completed'
                      ? 'Upload concluído'
                      : item.error || 'Upload cancelado'}
                  </p>
                </div>
              </div>

              {item.status === 'uploading' ? (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-newTableHeader">
                  <div className="h-full rounded-full bg-btnPrimary transition-[width]" style={{ width: `${item.progress}%` }} />
                </div>
              ) : null}

              {item.status === 'error' && item.error ? (
                <p className="mt-2 text-xs leading-5 text-red-500">{item.error}</p>
              ) : null}

              <div className="mt-3 flex justify-end gap-2">
                {item.status === 'error' ? (
                  <button type="button" onClick={() => void uploader.retry(item.id)} className="min-h-10 rounded-xl bg-btnPrimary/10 px-3 text-xs font-bold text-btnPrimary">
                    Tentar novamente
                  </button>
                ) : null}
                <button type="button" onClick={() => uploader.remove(item.id)} className="min-h-10 rounded-xl bg-red-500/10 px-3 text-xs font-bold text-red-500">
                  Remover
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {validationError ? <p className="mt-2 text-xs font-medium text-red-500">{validationError}</p> : null}
    </section>
  );
}
