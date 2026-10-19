import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

export class ListSessionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  testId?: string;
}
