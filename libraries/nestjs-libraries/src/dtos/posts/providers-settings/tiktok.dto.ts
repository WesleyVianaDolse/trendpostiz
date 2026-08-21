import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class TikTokDto {
  @ValidateIf((p) => p.title)
  @MaxLength(90)
  title: string;

  @ValidateIf((p) => p.content_posting_method === 'DIRECT_POST')
  @IsIn(
    [
      'PUBLIC_TO_EVERYONE',
      'MUTUAL_FOLLOW_FRIENDS',
      'FOLLOWER_OF_CREATOR',
      'SELF_ONLY',
    ],
    {
      message:
        'Please select who can see this video before publishing to TikTok.',
    }
  )
  privacy_level?:
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY';

  @IsBoolean()
  duet: boolean;

  @IsBoolean()
  stitch: boolean;

  @IsBoolean()
  comment: boolean;

  @IsIn(['yes', 'no'])
  autoAddMusic: 'yes' | 'no';

  @IsBoolean()
  brand_content_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  video_made_with_ai: boolean;

  @IsBoolean()
  brand_organic_toggle: boolean;

  @IsBoolean()
  disclose: boolean;

  @ValidateIf(
    (p) => p.disclose && !p.brand_organic_toggle && !p.brand_content_toggle
  )
  @Equals(false, {
    message:
      'Please select whether this content promotes your own brand or branded content.',
  })
  commercial_disclosure_selection_required?: boolean;

  @IsIn(['DIRECT_POST', 'UPLOAD'])
  @IsString()
  content_posting_method: 'DIRECT_POST' | 'UPLOAD';

  @ValidateIf((p) => p.content_posting_method === 'DIRECT_POST')
  @Equals(true)
  direct_post_consent?: boolean;

  @ValidateIf((p) => p.content_posting_method === 'DIRECT_POST')
  @Equals(true)
  creator_info_loaded?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_video_post_duration_sec?: number;
}
