'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Uppy from '@uppy/core';
import Compressor from '@uppy/compressor';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { getUppyUploadPlugin } from '@gitroom/react/helpers/uppy.upload';
import { PublisherMedia } from '../model/publisher.types';
import { validatePublisherFile } from './media-validation';
import {
  PublisherUploadItem,
  removePublisherUploadItem,
  updatePublisherUploadItem,
} from './upload-state';

type PublisherUppyMeta = Record<string, unknown>;
type PublisherUppyBody = Record<string, unknown>;

interface TransloaditResult {
  url?: string;
  name?: string;
  user_meta?: { addedOrder?: number | string };
}

class PublisherCompression extends Compressor<
  PublisherUppyMeta,
  PublisherUppyBody
> {
  override async prepareUpload(fileIDs: string[]) {
    const { files } = this.uppy.getState();
    const compressible = fileIDs.filter((id) => {
      const file = files[id];
      if (!file) return false;
      return !(
        file.type === 'image/gif' ||
        (file.name || '').toLowerCase().endsWith('.gif')
      );
    });
    return super.prepareUpload(compressible);
  }
}

function savedMedia(source: unknown): PublisherMedia | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const container = source as Record<string, unknown>;
  const response =
    container.response && typeof container.response === 'object'
      ? (container.response as Record<string, unknown>)
      : container;
  const body = response.body ?? response;
  if (!body || typeof body !== 'object') return undefined;
  const parsedBody = body as Record<string, unknown>;
  const saved =
    parsedBody.saved && typeof parsedBody.saved === 'object'
      ? (parsedBody.saved as Record<string, unknown>)
      : parsedBody;
  if (typeof saved.id !== 'string' || typeof saved.path !== 'string') {
    return undefined;
  }
  return {
    id: saved.id,
    path: saved.path,
    ...(typeof saved.alt === 'string' ? { alt: saved.alt } : {}),
    ...(typeof saved.thumbnail === 'string'
      ? { thumbnail: saved.thumbnail }
      : {}),
    ...(typeof saved.thumbnailTimestamp === 'number'
      ? { thumbnailTimestamp: saved.thumbnailTimestamp }
      : {}),
  };
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'Upload cancelado.';
    return error.message || 'Falha durante o upload.';
  }
  return 'Falha durante o upload.';
}

export function usePublisherUploader() {
  const fetch = useFetch();
  const { storageProvider, backendUrl, disableImageCompression, transloadit } =
    useVariables();
  const [uppy, setUppy] =
    useState<Uppy<PublisherUppyMeta, PublisherUppyBody>>();
  const [items, setItems] = useState<PublisherUploadItem[]>([]);
  const [selectionError, setSelectionError] = useState<string>();

  useEffect(() => {
    const instance = new Uppy<PublisherUppyMeta, PublisherUppyBody>({
      autoProceed: true,
      restrictions: {
        maxFileSize: 1_000_000_000,
        allowedFileTypes: [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'video/mp4',
          'video/quicktime',
        ],
      },
    });

    const { plugin, options } = getUppyUploadPlugin(
      transloadit.length ? 'transloadit' : storageProvider,
      fetch,
      backendUrl,
      transloadit
    );
    instance.use(plugin, options);

    if (!disableImageCompression) {
      instance.use(PublisherCompression, {
        convertTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxWidth: 1000,
        maxHeight: 1000,
        quality: 1,
      });
    }

    instance.on('file-added', (file) => {
      const previewUrl = URL.createObjectURL(file.data as Blob);
      setItems((current) => [
        ...current,
        {
          id: file.id,
          name: file.name || 'Arquivo',
          type: file.type || '',
          size: file.size || 0,
          previewUrl,
          progress: 0,
          status: 'selected',
        },
      ]);
    });

    instance.on('upload-start', (files) => {
      setItems((current) =>
        files.reduce(
          (list, file) =>
            updatePublisherUploadItem(list, file.id, {
              status: 'uploading',
              error: undefined,
            }),
          current
        )
      );
    });

    instance.on('upload-progress', (file, progress) => {
      if (!file) return;
      const percentage = progress.bytesTotal
        ? Math.round((progress.bytesUploaded / progress.bytesTotal) * 100)
        : 0;
      setItems((current) =>
        updatePublisherUploadItem(current, file.id, {
          status: 'uploading',
          progress: percentage,
        })
      );
    });

    instance.on('upload-error', (file, error) => {
      if (!file) return;
      setItems((current) =>
        updatePublisherUploadItem(current, file.id, {
          status: 'error',
          error: uploadErrorMessage(error),
        })
      );
    });

    instance.on('upload-success', (file, response) => {
      if (!file) return;
      const media = savedMedia(response) || savedMedia(file);
      if (!media && transloadit.length) return;
      setItems((current) =>
        updatePublisherUploadItem(
          current,
          file.id,
          media
            ? { status: 'completed', progress: 100, media }
            : {
                status: 'error',
                error: 'O upload terminou, mas a resposta de mídia é inválida.',
              }
        )
      );
    });

    instance.on('complete', async (result) => {
      if (transloadit.length) {
        try {
          const transloaditResults = (
            result as unknown as {
              transloadit?: Array<{
                results?: Record<string, TransloaditResult[]>;
              }>;
            }
          ).transloadit?.[0]?.results;
          const converted = Object.values(transloaditResults || {})
            .flatMap((value) => value)
            .map((value) => ({
              name: String(value.url || '')
                .split('/')
                .pop(),
              originalName: value.name || '',
              order: Number(value.user_meta?.addedOrder || 0),
            }))
            .filter((value) => value.name);
          const unique = [
            ...new Map(converted.map((value) => [value.name, value])).values(),
          ].sort((a, b) => a.order - b.order);
          const saved = await Promise.all(
            unique.map(async (value) => {
              const response = await fetch('/media/save-media', {
                method: 'POST',
                body: JSON.stringify({
                  name: value.name,
                  originalName: value.originalName,
                }),
              });
              if (!response.ok)
                throw new Error('Falha ao registrar a mídia processada.');
              return (await response.json()) as PublisherMedia;
            })
          );
          setItems((current) =>
            current.map((item, index) =>
              saved[index]
                ? {
                    ...item,
                    status: 'completed',
                    progress: 100,
                    media: saved[index],
                  }
                : item
            )
          );
        } catch (error) {
          setItems((current) =>
            current.map((item) =>
              item.status === 'completed'
                ? item
                : { ...item, status: 'error', error: uploadErrorMessage(error) }
            )
          );
        }
      }

      for (const file of result.successful) {
        const media = savedMedia(file);
        if (media) continue;
        if (!transloadit.length) {
          setItems((current) =>
            current.some(
              (item) => item.id === file.id && item.status === 'completed'
            )
              ? current
              : updatePublisherUploadItem(current, file.id, {
                  status: 'error',
                  error: 'O backend não retornou um MediaDto válido.',
                })
          );
        }
      }
    });

    setUppy(instance);
    return () => {
      instance.destroy();
      setUppy(undefined);
    };
  }, [
    backendUrl,
    disableImageCompression,
    fetch,
    storageProvider,
    transloadit,
  ]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      if (!uppy) return;
      setSelectionError(undefined);
      for (const [index, file] of Array.from(files).entries()) {
        const validationError = validatePublisherFile(file);
        if (validationError) {
          setSelectionError(`${file.name}: ${validationError}`);
          continue;
        }
        try {
          uppy.addFile({
            source: 'publisher-native-picker',
            name: file.name,
            type: file.type,
            data: file,
            meta: { addedOrder: items.length + index },
          });
        } catch (error) {
          setSelectionError(uploadErrorMessage(error));
        }
      }
    },
    [items.length, uppy]
  );

  const retry = useCallback(
    async (id: string) => {
      if (!uppy?.getFile(id)) return;
      setItems((current) =>
        updatePublisherUploadItem(current, id, {
          status: 'uploading',
          error: undefined,
        })
      );
      try {
        await uppy.retryUpload(id);
      } catch (error) {
        setItems((current) =>
          updatePublisherUploadItem(current, id, {
            status: 'error',
            error: uploadErrorMessage(error),
          })
        );
      }
    },
    [uppy]
  );

  const remove = useCallback(
    (id: string) => {
      const item = items.find((current) => current.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (uppy?.getFile(id)) uppy.removeFile(id);
      setItems((current) => removePublisherUploadItem(current, id));
    },
    [items, uppy]
  );

  const media = useMemo(
    () =>
      items
        .filter((item) => item.status === 'completed' && item.media)
        .map((item) => item.media as PublisherMedia),
    [items]
  );

  return {
    ready: Boolean(uppy),
    items,
    media,
    selectionError,
    isUploading: items.some(
      (item) => item.status === 'selected' || item.status === 'uploading'
    ),
    hasErrors: items.some((item) => item.status === 'error'),
    addFiles,
    retry,
    remove,
  };
}
