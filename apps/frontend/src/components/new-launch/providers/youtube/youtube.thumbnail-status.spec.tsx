const mockFetch = jest.fn();
const mockMutate = jest.fn();
const mockSWR = jest.fn();
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('swr', () => ({
  __esModule: true,
  default: (...args: any[]) => mockSWR(...args),
}));
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { YoutubeThumbnailStatus } from './youtube.thumbnail-status';

describe('thumbnail status and isolated retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSWR.mockReturnValue({
      data: {
        videoId: 'video-1',
        status: 'failed',
        canRetry: true,
        error: 'O YouTube negou o envio da capa (403).',
      },
      mutate: mockMutate,
    });
  });
  it('shows the failure separately and retries only the thumbnail endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'pending' }),
    });
    render(<YoutubeThumbnailStatus postId="post" />);
    expect(screen.getByText(/403/)).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      'https://www.youtube.com/watch?v=video-1'
    );
    fireEvent.click(screen.getByRole('button', { name: /somente a capa/ }));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/posts/post/youtube-thumbnail/retry',
      { method: 'POST' }
    );
  });
  it('does not offer a new retry after confirmed application', () => {
    mockSWR.mockReturnValue({
      data: { status: 'applied', canRetry: false },
      mutate: mockMutate,
    });
    render(<YoutubeThumbnailStatus postId="post" />);
    expect(screen.getByText('Capa enviada ao YouTube')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
