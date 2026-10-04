import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SetupAdminDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phoneNumber?: string;
}

export class SetupCompanyDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class SetupWhatsAppDto {
  @IsOptional()
  @IsString()
  businessId?: string;

  @IsString()
  accessToken: string;

  @IsString()
  phoneNumberId: string;

  @IsString()
  webhookUrl: string;

  @IsOptional()
  @Matches(/^v\d{2}\.\d$/)
  apiVersion?: string;

  @IsOptional()
  @IsUrl()
  apiBaseUrl?: string;
}

export class CreateSetupDto {
  @ValidateNested()
  @Type(() => SetupAdminDto)
  admin: SetupAdminDto;

  @ValidateNested()
  @Type(() => SetupCompanyDto)
  company: SetupCompanyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SetupWhatsAppDto)
  whatsapp?: SetupWhatsAppDto;
}
