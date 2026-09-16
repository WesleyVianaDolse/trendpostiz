'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { FacebookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { FacebookPreview } from '@gitroom/frontend/components/new-launch/providers/facebook/facebook.preview';

export const FacebookSettings = () => {
  const { register, watch } = useSettings();
  const postType = watch('post_type');

  return (
    <>
      <Select
        label="Post Type"
        {...register('post_type', { value: 'post' })}
      >
        <option value="post">Post / Reel</option>
        <option value="story">Story</option>
      </Select>
      {postType !== 'story' && (
        <Input
          label="Embedded URL (only for text Post)"
          {...register('url')}
        />
      )}
    </>
  );
};

export default withProvider<FacebookDto>({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: FacebookSettings,
  CustomPreviewComponent: FacebookPreview,
  dto: FacebookDto,
  checkValidity: async ([firstPost] = [], settings) => {
    if (settings?.post_type !== 'story') return true;
    if (!firstPost?.length) {
      return 'Facebook Stories require at least one image or video';
    }

    const videos = firstPost.filter((media) =>
      /\.(mp4|mov)(?:[?#]|$)/i.test(media.path)
    );
    if (videos.length && videos.length !== firstPost.length) {
      return 'Facebook Stories cannot mix images and videos';
    }
    return true;
  },
  maximumCharacters: 63206,
});
