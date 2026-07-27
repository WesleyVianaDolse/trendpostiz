import {
  IsDefined,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTeamMemberDto {
  @IsString()
  @IsDefined()
  @MinLength(2)
  @MaxLength(128)
  name: string;

  @IsEmail()
  @IsDefined()
  email: string;

  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(64)
  password: string;

  @IsString()
  @IsIn(['USER', 'ADMIN'])
  role: 'USER' | 'ADMIN';
}
