import { PublisherMedia } from '../model/publisher.types';

export type PublisherUploadStatus =
  | 'selected'
  | 'uploading'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface PublisherUploadItem {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl: string;
  progress: number;
  status: PublisherUploadStatus;
  error?: string;
  media?: PublisherMedia;
}

export function updatePublisherUploadItem(
  items: PublisherUploadItem[],
  id: string,
  update: Partial<PublisherUploadItem>
) {
  return items.map((item) => (item.id === id ? { ...item, ...update } : item));
}

export function removePublisherUploadItem(
  items: PublisherUploadItem[],
  id: string
) {
  return items.filter((item) => item.id !== id);
}
