import { IsOptional, IsString } from 'class-validator';

/** Sem `testId`, vale a participação mais recente — é como o app chama hoje. */
export class SessionLookupDto {
  @IsOptional()
  @IsString()
  testId?: string;
}
