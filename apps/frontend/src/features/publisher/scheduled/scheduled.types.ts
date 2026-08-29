import {
  PublisherMedia,
  PublisherProviderSettings,
} from '../model/publisher.types';

export type PublisherPostState = 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT';

export interface ScheduledListPost {
  id: string;
  content: string;
  publishDate: string;
  state: PublisherPostState;
  group: string;
  integration?: {
    id: string;
    providerIdentifier: string;
    name: string;
    picture?: string;
  };
}

export interface ScheduledListPage {
  posts: ScheduledListPost[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface ScheduledDetailPost {
  id: string;
  content: string;
  publishDate: string;
  state: PublisherPostState;
  group: string;
  delay: number;
  image: PublisherMedia[];
  error?: string | null;
  tags?: Array<{ tag: { id?: string; name: string } }>;
  integration?: {
    id: string;
    providerIdentifier: string;
    name: string;
    picture?: string;
  };
}

export interface ScheduledPostDetail {
  group: string;
  posts: ScheduledDetailPost[];
  integration: string;
  integrationPicture?: string;
  settings: PublisherProviderSettings;
}

export interface ScheduledActionIssue {
  message: string;
  ambiguous: boolean;
}
