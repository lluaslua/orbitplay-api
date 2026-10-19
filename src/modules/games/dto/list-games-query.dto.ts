import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CATALOG_TABS } from '../../../common/constants/domain.constants';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import type { CatalogTab } from '../../../contracts';

export class ListGamesQueryDto extends PaginationQueryDto {
  /** Só vale para a administração: o estúdio sempre vê a própria organização. */
  @IsOptional()
  @IsString()
  studioId?: string;

  /** "Buscar jogo..." — nome do jogo ou do estúdio. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /** Abas de "Jogos disponíveis" (Figma `849:2926`). Só para o jogador e a landing. */
  @IsOptional()
  @IsIn(CATALOG_TABS)
  tab?: CatalogTab;
}
