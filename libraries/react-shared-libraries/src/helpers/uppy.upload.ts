import AwsS3Multipart from '@uppy/aws-s3';
import sha256 from 'sha256';
import Transloadit from '@uppy/transloadit';
import { BasePlugin } from '@uppy/core';

const LOCAL_UPLOAD_RETRY_DELAYS = [0, 1000, 2000, 5000, 10000, 20000];
const LOCAL_UPLOAD_REQUEST_TIMEOUT = 120_000;

class LocalResumableUpload extends BasePlugin<any, any, any> {
  private fetch: any;
  private controllers = new Map<string, AbortController>();
  private uploadFiles = this.handleUpload.bind(this);
  private removeFile = this.handleFileRemoved.bind(this);
  private cancelAll = this.handleCancelAll.bind(this);

  constructor(uppy: any, options: { fetch: any }) {
    super(uppy, options);
    this.id = 'LocalResumableUpload';
    this.type = 'uploader';
    this.fetch = options.fetch;
  }

  install() {
    this.uppy.addUploader(this.uploadFiles);
    this.uppy.on('file-removed', this.removeFile);
    this.uppy.on('cancel-all', this.cancelAll);
  }

  uninstall() {
    this.uppy.removeUploader(this.uploadFiles);
    this.uppy.off('file-removed', this.removeFile);
    this.uppy.off('cancel-all', this.cancelAll);
    this.handleCancelAll();
  }

  private storageKey(file: any) {
    const modified = file.data?.lastModified || 0;
    return `postiz:resumable-upload:${encodeURIComponent(
      `${file.name}:${file.size}:${modified}`
    )}`;
  }

  private async request(
    url: string,
    options: RequestInit,
    signal: AbortSignal
  ) {
    let lastError: Error = new Error('Upload failed.');
    for (const delay of LOCAL_UPLOAD_RETRY_DELAYS) {
      if (signal.aborted)
        throw new DOMException('Upload cancelled.', 'AbortError');
      if (delay) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, delay);
          signal.addEventListener(
            'abort',
            () => {
              window.clearTimeout(timer);
              reject(new DOMException('Upload cancelled.', 'AbortError'));
            },
            { once: true }
          );
        });
      }

      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      signal.addEventListener('abort', abortRequest, { once: true });
      const timeout = window.setTimeout(
        () => requestController.abort(),
        LOCAL_UPLOAD_REQUEST_TIMEOUT
      );
      try {
        const response = await this.fetch(url, {
          ...options,
          signal: requestController.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return body;
        lastError = new Error(
          body?.message || body?.msg || `Upload failed (${response.status}).`
        );
        if (
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429
        ) {
          throw Object.assign(lastError, { retryable: false });
        }
      } catch (error) {
        if (signal.aborted) throw error;
        if ((error as any)?.retryable === false) throw error;
        lastError = error instanceof Error ? error : lastError;
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', abortRequest);
      }
    }
    throw lastError;
  }

  private async uploadFile(file: any) {
    const controller = new AbortController();
    this.controllers.set(file.id, controller);
    const storageKey = this.storageKey(file);

    try {
      const previousUploadId =
        window.localStorage.getItem(storageKey) || undefined;
      const initialized = await this.request(
        '/media/resumable-upload',
        {
          method: 'POST',
          body: JSON.stringify({
            uploadId: previousUploadId,
            originalName: file.name,
            size: file.size,
            type: file.type,
          }),
        },
        controller.signal
      );
      const { uploadId, chunkSize } = initialized;
      window.localStorage.setItem(storageKey, uploadId);
      const uploadedParts = new Set<number>(initialized.uploadedParts || []);
      const blob = file.data as Blob;
      let bytesUploaded = 0;

      for (let part = 0; part < Math.ceil(file.size / chunkSize); part++) {
        const start = part * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        if (!uploadedParts.has(part)) {
          const form = new FormData();
          form.append('chunk', blob.slice(start, end), `${file.name}.part`);
          await this.request(
            `/media/resumable-upload/${uploadId}/${part}`,
            { method: 'POST', body: form },
            controller.signal
          );
        }
        bytesUploaded = end;
        this.uppy.emit('upload-progress', this.uppy.getFile(file.id), {
          uploadStarted:
            this.uppy.getFile(file.id).progress.uploadStarted || Date.now(),
          bytesUploaded,
          bytesTotal: file.size,
        });
      }

      const saved = await this.request(
        `/media/resumable-upload/${uploadId}/complete`,
        { method: 'POST' },
        controller.signal
      );
      this.controllers.delete(file.id);
      window.localStorage.removeItem(storageKey);
      this.uppy.emit('upload-success', this.uppy.getFile(file.id), {
        status: 200,
        body: { saved },
        uploadURL: saved.path,
      });
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        this.uppy.emit(
          'upload-error',
          this.uppy.getFile(file.id),
          error instanceof Error ? error : new Error('Upload failed.')
        );
      }
      throw error;
    } finally {
      this.controllers.delete(file.id);
    }
  }

  private async handleUpload(fileIds: string[]) {
    const files = this.uppy.getFilesByIds(fileIds);
    this.uppy.emit('upload-start', files);
    // Sequential uploads are intentional: they avoid saturating mobile connections.
    for (const file of files) await this.uploadFile(file);
  }

  private handleFileRemoved(file: any) {
    const controller = this.controllers.get(file.id);
    if (!controller) return;
    controller.abort();
    const uploadId = window.localStorage.getItem(this.storageKey(file));
    if (uploadId) {
      void this.fetch(`/media/resumable-upload/${uploadId}`, {
        method: 'DELETE',
      });
      window.localStorage.removeItem(this.storageKey(file));
    }
  }

  private handleCancelAll() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}
const fetchUploadApiEndpoint = async (
  fetch: any,
  endpoint: string,
  data: any
) => {
  const res = await fetch(`/media/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message || body?.msg || 'Upload failed.');
  }
  return body;
};

// Define the factory to return appropriate Uppy configuration
export const getUppyUploadPlugin = (
  provider: string,
  fetch: any,
  backendUrl: string,
  transloadit: string[] = []
) => {
  switch (provider) {
    case 'transloadit':
      return {
        plugin: Transloadit,
        options: {
          waitForEncoding: true,
          alwaysRunAssembly: true,
          assemblyOptions: {
            params: {
              auth: { key: transloadit[0] },
              template_id: transloadit[1],
            },
          },
        },
      };
    case 'cloudflare':
      return {
        plugin: AwsS3Multipart,
        options: {
          limit: 3,
          retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
          getChunkSize: () => 10 * 1024 * 1024,
          shouldUseMultipart: (file: any) => true,
          endpoint: '',
          createMultipartUpload: async (file: any) => {
            let fileHash = '';
            const contentType = file.type;

            // Skip hash calculation for files larger than 100MB to avoid "Invalid array length" error
            if (file.size <= 100 * 1024 * 1024) {
              try {
                const arrayBuffer = await new Response(file.data).arrayBuffer();
                fileHash = sha256(Buffer.from(arrayBuffer));
              } catch (error) {
                console.warn(
                  'Failed to calculate file hash, proceeding without hash:',
                  error
                );
                fileHash = '';
              }
            }

            return fetchUploadApiEndpoint(fetch, 'create-multipart-upload', {
              file,
              fileHash,
              contentType,
            });
          },
          listParts: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'list-parts', {
              file,
              ...props,
            }),
          signPart: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'sign-part', {
              file,
              ...props,
            }),
          abortMultipartUpload: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'abort-multipart-upload', {
              file,
              ...props,
            }),
          completeMultipartUpload: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'complete-multipart-upload', {
              file,
              ...props,
            }),
        },
      };
    case 'local':
      return {
        plugin: LocalResumableUpload,
        options: {
          fetch,
        },
      };

    // Add more cases for other cloud providers
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
};
