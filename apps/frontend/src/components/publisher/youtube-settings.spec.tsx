jest.mock('@gitroom/frontend/components/media/media.component', () => ({
  MediaComponent: (props: any) => (
    <div data-testid="thumbnail" data-ratio={props.previewAspectRatio}>
      <button
        type="button"
        onClick={() =>
          props.onChange({
            target: {
              value: { id: 'cover', path: 'https://cdn.example/cover.png' },
            },
          })
        }
      >
        Select cover
      </button>
      <button type="button" onClick={() => props.onChange({ target: {} })}>
        Clear cover
      </button>
    </div>
  ),
}));

import 'reflect-metadata';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import { ProviderSettings } from './provider-settings';
import {
  validateYoutubeThumbnail,
  MAX_YOUTUBE_THUMBNAIL_SIZE,
} from '../new-launch/providers/youtube/youtube.thumbnail';
import { buildPostPayload } from '@gitroom/frontend/features/publisher/model/build-post-payload';
import { buildScheduledEditPayload } from '@gitroom/frontend/features/publisher/scheduled/scheduled-api';

const integration = {
  id: 'youtube-account',
  identifier: 'youtube',
  name: 'Channel',
};
const changes = jest.fn();
function Settings() {
  const [settings, setSettings] = useState({ type: 'private', title: 'Title' });
  return (
    <ProviderSettings
      integrations={[integration]}
      settingsByIntegration={{ [integration.id]: settings }}
      onChange={(id, key, value) => {
        changes(id, key, value);
        setSettings((previous) => ({ ...previous, [key]: value }));
      }}
    />
  );
}

describe('YouTube covers in Publisher', () => {
  beforeEach(() => changes.mockClear());
  it('reuses the selector, previews 9:16 for Shorts and supports selecting and clearing', () => {
    render(<Settings />);
    expect(screen.getByTestId('thumbnail').getAttribute('data-ratio')).toBe(
      '16 / 9'
    );
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'short' },
    });
    expect(screen.getByTestId('thumbnail').getAttribute('data-ratio')).toBe(
      '9 / 16'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select cover' }));
    expect(changes).toHaveBeenCalledWith(integration.id, 'thumbnail', {
      id: 'cover',
      path: 'https://cdn.example/cover.png',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear cover' }));
    expect(changes).toHaveBeenCalledWith(
      integration.id,
      'thumbnail',
      undefined
    );
  });

  it.each(['now', 'schedule'] as const)(
    'persists the cover and layout in the %s payload',
    (mode) => {
      const settings = {
        title: 'Title',
        type: 'private',
        thumbnailLayout: 'short',
        thumbnail: { id: 'cover', path: 'https://cdn.example/cover.png' },
      };
      const payload = buildPostPayload({
        mode,
        content: 'Description',
        integrations: [{ id: integration.id, settings }],
        now: new Date('2030-01-01T10:00:00Z'),
        scheduleDate: '2030-01-02',
        scheduleTime: '12:00',
        media: [
          {
            id: 'video',
            path: 'https://cdn.example/video.mp4',
            thumbnail: 'https://cdn.example/fallback.jpg',
          },
        ],
      });
      expect(payload.posts[0].settings).toEqual(settings);
      expect(payload.posts[0].value[0].image[0].thumbnail).toBe(
        'https://cdn.example/fallback.jpg'
      );
    }
  );

  it('keeps the selected cover when editing an existing scheduled post', () => {
    const settings = {
      title: 'Title',
      type: 'unlisted',
      thumbnailLayout: 'short',
      thumbnail: { id: 'cover', path: 'https://cdn.example/cover.png' },
    };
    const payload = buildScheduledEditPayload(
      {
        group: 'group',
        integration: integration.id,
        settings,
        posts: [
          {
            id: 'post',
            group: 'group',
            state: 'QUEUE',
            content: 'Description',
            delay: 0,
            publishDate: '2030-01-01T10:00:00Z',
            image: [{ id: 'video', path: 'https://cdn.example/video.mp4' }],
          },
        ],
      },
      { post: 'Edited' },
      settings
    );
    expect(payload.posts[0].settings).toMatchObject(settings);
  });

  it.each([
    ['JPEG', [255, 216, 255, 224, 0, 16, 74, 70]],
    ['PNG', [137, 80, 78, 71, 13, 10, 26, 10]],
  ])('accepts %s image signatures', async (_, bytes: number[]) => {
    await expect(
      validateYoutubeThumbnail(
        new NodeBlob([Buffer.from(bytes)]) as unknown as Blob
      )
    ).resolves.toBeUndefined();
  });
  it('rejects GIF and rejects files over 50 MB before reading them', async () => {
    await expect(
      validateYoutubeThumbnail(new NodeBlob(['GIF89a']) as unknown as Blob)
    ).rejects.toThrow('JPEG ou PNG');
    await expect(
      validateYoutubeThumbnail({ size: MAX_YOUTUBE_THUMBNAIL_SIZE + 1 } as Blob)
    ).rejects.toThrow('50 MB');
  });
});
