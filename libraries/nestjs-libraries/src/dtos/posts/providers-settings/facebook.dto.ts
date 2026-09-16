import { IsIn, IsOptional, ValidateIf, IsUrl } from 'class-validator';

export class FacebookDto {
  @IsOptional()
  @IsIn(['post', 'story'])
  post_type?: 'post' | 'story';

  @IsOptional()
  @ValidateIf((settings) => settings.post_type !== 'story' && settings.url)
  @IsUrl()
  url?: string;
}
