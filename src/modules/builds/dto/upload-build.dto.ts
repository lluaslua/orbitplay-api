import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadBuildDto {
  /** Opcional: sem ela, a versão sai do nome do arquivo (`versionOf`). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  version?: string;
}
