import { IsIn } from 'class-validator';

export class SetStatusDto {
  @IsIn(['PAUSED', 'ACTIVE'])
  status: 'PAUSED' | 'ACTIVE';
}
