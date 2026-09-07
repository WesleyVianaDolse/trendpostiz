export interface InstagramWebhookCommentAuthor {
  id?: string;
  username?: string;
}

export interface InstagramWebhookCommentMedia {
  id?: string;
  media_product_type?: string;
}

export interface InstagramWebhookCommentValue {
  id?: string;
  from?: InstagramWebhookCommentAuthor;
  text?: string;
  media?: InstagramWebhookCommentMedia;
}

export interface InstagramWebhookChange {
  field?: string;
  value?: InstagramWebhookCommentValue;
}

export interface InstagramWebhookEntry {
  id?: string;
  time?: number;
  changes?: InstagramWebhookChange[];
  messaging?: unknown[];
}

export interface InstagramWebhookPayload {
  object?: string;
  entry?: InstagramWebhookEntry[];
}
