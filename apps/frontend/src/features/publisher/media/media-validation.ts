import { PublisherMedia } from '../model/publisher.types';

export const MAX_PUBLISHER_IMAGE_SIZE = 30 * 1024 * 1024;
export const MAX_PUBLISHER_VIDEO_SIZE = 1_000_000_000;

const allowedTypes = new Map([
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/gif', ['.gif']],
  ['image/webp', ['.webp']],
  ['video/mp4', ['.mp4', '.mov']],
  ['video/quicktime', ['.mov', '.mp4']],
]);

export interface PublisherFileLike {
  name: string;
  type: string;
  size: number;
}

export function validatePublisherFile(file: PublisherFileLike) {
  const extensions = allowedTypes.get(file.type);
  const name = file.name.toLowerCase();
  if (!extensions || !extensions.some((extension) => name.endsWith(extension))) {
    return 'Formato não permitido. Use JPEG, PNG, GIF, WebP, MP4 ou MOV.';
  }

  if (file.type.startsWith('image/') && file.size > MAX_PUBLISHER_IMAGE_SIZE) {
    return 'A imagem excede o limite de 30 MB.';
  }
  if (file.type.startsWith('video/') && file.size > MAX_PUBLISHER_VIDEO_SIZE) {
    return 'O vídeo excede o limite de 1 GB.';
  }

  return undefined;
}

export function isVideoMedia(media: PublisherMedia) {
  const path = media.path.toLowerCase().split('?')[0];
  return path.endsWith('.mp4') || path.endsWith('.mov');
}

export function validateProviderMedia(
  identifier: string,
  media: PublisherMedia[]
) {
  switch (identifier) {
    case 'instagram':
    case 'instagram-standalone':
      return media.length > 0
        ? undefined
        : 'Instagram exige pelo menos uma imagem ou vídeo.';
    case 'youtube':
      if (media.length !== 1) return 'YouTube exige exatamente uma mídia.';
      if (!media[0].path.toLowerCase().split('?')[0].endsWith('.mp4')) {
        return 'A mídia do YouTube deve ser um vídeo MP4.';
      }
      return undefined;
    default:
      return undefined;
  }
}
