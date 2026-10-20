jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn() })) },
    youtube: jest.fn(),
  },
}));
jest.mock('axios', () => jest.fn());

import 'reflect-metadata';
import axios from 'axios';
import { google } from 'googleapis';
import { YoutubeProvider } from './youtube.provider';

describe('YouTube upload audience', () => {
  const insert = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (google.youtube as jest.Mock).mockReturnValue({ videos: { insert } });
    insert.mockResolvedValue({ data: { id: 'video-1' } });
    (axios as unknown as jest.Mock).mockResolvedValue({ data: 'video-stream' });
  });

  it.each([
    ['omitted', {}, undefined],
    ['undefined', { selfDeclaredMadeForKids: undefined }, undefined],
    ['null', { selfDeclaredMadeForKids: null }, undefined],
    ['empty', { selfDeclaredMadeForKids: '' }, undefined],
    ['explicit yes', { selfDeclaredMadeForKids: 'yes' }, true],
    ['explicit no', { selfDeclaredMadeForKids: 'no' }, false],
  ])(
    'preserves %s without inventing an audience choice',
    async (_, audience, expected) => {
      const result = await new YoutubeProvider().post('channel-1', 'token', [
        {
          id: 'post-1',
          message: 'Description',
          media: [{ path: 'https://cdn.example/video.mp4' }],
          settings: { title: 'Video title', type: 'private', ...audience },
        },
      ] as any);

      expect(google.youtube).toHaveBeenCalledWith(
        expect.objectContaining({ version: 'v3' })
      );
      expect(insert).toHaveBeenCalledTimes(1);
      const request = insert.mock.calls[0][0];
      expect(request.part).toEqual(['id', 'snippet', 'status']);
      expect(request.requestBody.snippet).toEqual({
        title: 'Video title',
        description: 'Description',
      });
      expect(request.requestBody.status).toEqual({
        privacyStatus: 'private',
        ...(expected === undefined
          ? {}
          : { selfDeclaredMadeForKids: expected }),
      });
      expect(request.requestBody.status).not.toHaveProperty('madeForKids');
      expect(request.media.body).toBe('video-stream');
      expect(result[0]).toMatchObject({ postId: 'video-1', status: 'success' });
    }
  );
});
