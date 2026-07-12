import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches } from 'class-validator';

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

export class RegisterDto {
  @ApiProperty({ example: 'ada.lovelace@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Str0ng!Passw0rd', minLength: 12 })
  @IsString()
  @Length(12, 128)
  @Matches(STRONG_PASSWORD_REGEX, {
    message: 'password must contain an uppercase letter, a lowercase letter, a digit, and a special character',
  })
  password!: string;

  @ApiProperty({ example: 'Ada' })
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiProperty({ example: 'Lovelace' })
  @IsString()
  @Length(1, 100)
  lastName!: string;
}
