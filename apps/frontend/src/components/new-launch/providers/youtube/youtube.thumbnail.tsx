'use client';

import { useCallback } from 'react';
import { MediaComponent } from '@gitroom/frontend/components/media/media.component';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';

export const MAX_YOUTUBE_THUMBNAIL_SIZE = 50 * 1024 * 1024;

export async function validateYoutubeThumbnail(blob: Blob) {
  if (blob.size > MAX_YOUTUBE_THUMBNAIL_SIZE)
    throw new Error('A capa deve ter no máximo 50 MB.');
  const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (byte, index) => bytes[index] === byte
  );
  if (!jpeg && !png) throw new Error('Selecione uma capa JPEG ou PNG.');
}

export function YoutubeThumbnailPicker({
  short,
  value,
  onChange,
}: {
  short: boolean;
  value?: { id: string; path: string };
  onChange: (value?: { id: string; path: string }) => void;
}) {
  const directory = useMediaDirectory();
  const validate = useCallback(
    async (media: { path: string }) => {
      const response = await fetch(directory.set(media.path));
      if (!response.ok)
        throw new Error('Não foi possível validar a capa. Tente novamente.');
      if (
        Number(response.headers.get('content-length')) >
        MAX_YOUTUBE_THUMBNAIL_SIZE
      ) {
        throw new Error('A capa deve ter no máximo 50 MB.');
      }
      await validateYoutubeThumbnail(await response.blob());
    },
    [directory]
  );
  return (
    <div className="space-y-2">
      <MediaComponent
        name="thumbnail"
        type="image"
        label="Capa personalizada (opcional)"
        description={
          short
            ? 'Prévia de corte 9:16. Mantenha o conteúdo principal na área central.'
            : 'Capa para vídeo comum, em 16:9.'
        }
        width={short ? 1080 : 1280}
        height={short ? 1920 : 720}
        previewAspectRatio={short ? '9 / 16' : '16 / 9'}
        value={value}
        validateMedia={validate}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-textItemBlur">
        JPEG ou PNG, até 50 MB. A capa será enviada após o processamento. A
        exibição e o corte podem variar entre as superfícies do YouTube.
      </p>
    </div>
  );
}
