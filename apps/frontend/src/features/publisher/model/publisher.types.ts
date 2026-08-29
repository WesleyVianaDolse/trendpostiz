export type PublisherMode = 'now' | 'schedule';

export interface PublisherIntegration {
  id: string;
  name: string;
  display?: string;
  identifier: string;
  picture?: string;
  disabled?: boolean;
  inBetweenSteps?: boolean;
  refreshNeeded?: boolean;
  additionalSettings?: string;
  stripLinks?: boolean;
}

export type PublisherProviderSettings = Record<string, unknown>;

export interface PublisherMedia {
  id: string;
  path: string;
  url?: string;
  alt?: string;
  thumbnail?: string;
  thumbnailTimestamp?: number;
}

export interface PublisherPostPayload {
  type: PublisherMode;
  tags: Array<{ value: string; label: string }>;
  shortLink: boolean;
  date: string;
  posts: Array<{
    integration: { id: string };
    group: string;
    settings: PublisherProviderSettings;
    value: Array<{
      id?: string;
      content: string;
      delay: number;
      image: PublisherMedia[];
    }>;
  }>;
}

export interface BuildPostPayloadInput {
  mode: PublisherMode;
  content: string;
  integrations: Array<{
    id: string;
    settings: PublisherProviderSettings;
  }>;
  media?: PublisherMedia[];
  group?: string;
  scheduleDate?: string;
  scheduleTime?: string;
  now?: Date;
}

export interface PublisherValidationInput {
  mode: PublisherMode;
  content: string;
  selectedIntegrations: PublisherIntegration[];
  settingsByIntegration: Record<string, PublisherProviderSettings>;
  scheduleDate: string;
  scheduleTime: string;
  media: PublisherMedia[];
  uploadInProgress?: boolean;
  uploadHasErrors?: boolean;
}

export type PublisherValidationErrors = Partial<
  Record<'accounts' | 'content' | 'media' | 'schedule' | 'settings', string>
>;

export type PublisherSubmissionState =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'accepted'
  | 'error';

export interface PublisherPostResult {
  postId: string;
  integration: string;
}

export interface PublisherAcceptedSubmission {
  httpStatus: number;
  posts: PublisherPostResult[];
  payload: PublisherPostPayload;
}
