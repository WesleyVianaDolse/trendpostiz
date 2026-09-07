import { InstagramCommentMatchType } from '@prisma/client';

export const normalizeInstagramCommentPhrase = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const matchesInstagramComment = (
  comment: string,
  triggers: Array<{ normalizedPhrase: string }>,
  matchType: InstagramCommentMatchType
) => {
  const normalizedComment = normalizeInstagramCommentPhrase(comment);
  if (!normalizedComment) return false;

  return triggers.some(({ normalizedPhrase }) => {
    const trigger = normalizeInstagramCommentPhrase(normalizedPhrase);
    if (!trigger) return false;
    return matchType === 'EXACT'
      ? normalizedComment === trigger
      : normalizedComment.includes(trigger);
  });
};
