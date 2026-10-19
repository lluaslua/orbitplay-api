import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

export class ListPlaytestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  gameId?: string;
}
