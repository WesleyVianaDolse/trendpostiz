import {
  matchesInstagramComment,
  normalizeInstagramCommentPhrase,
} from './instagram-comment-matching';

describe('Instagram comment matching', () => {
  it('matches EXACT after case and whitespace normalization', () => {
    expect(
      matchesInstagramComment(
        'eu quero',
        [{ normalizedPhrase: 'EU   QUERO' }],
        'EXACT'
      )
    ).toBe(true);
  });

  it('does not partially match EXACT', () => {
    expect(
      matchesInstagramComment(
        'eu quero saber mais',
        [{ normalizedPhrase: 'EU QUERO' }],
        'EXACT'
      )
    ).toBe(false);
  });

  it('matches CONTAINS inside a longer comment', () => {
    expect(
      matchesInstagramComment(
        'Oi, EU QUERO saber mais',
        [{ normalizedPhrase: 'eu quero' }],
        'CONTAINS'
      )
    ).toBe(true);
  });

  it('matches any of multiple triggers', () => {
    expect(
      matchesInstagramComment(
        'me manda o link',
        [{ normalizedPhrase: 'eu quero' }, { normalizedPhrase: 'me manda' }],
        'CONTAINS'
      )
    ).toBe(true);
  });

  it('removes accents while normalizing', () => {
    expect(normalizeInstagramCommentPhrase('  QUÉRO  ')).toBe('quero');
  });
});
