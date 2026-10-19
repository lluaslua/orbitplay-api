import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  AGE_RATINGS,
  DEV_STAGES,
  ENGINES,
  GAME_MODES,
  GENRES,
  LANGUAGE_CODES,
  PLATFORMS,
} from '../../../common/constants/domain.constants';
import {
  AGE_RATING_ALIASES,
  DEV_STAGE_ALIASES,
  ENGINE_ALIASES,
  GAME_MODE_ALIASES,
  GENRE_ALIASES,
  LANGUAGE_ALIASES,
  PLATFORM_ALIASES,
  toCode,
  toCodes,
} from '../../../common/utils/vocabulary';
import type {
  AgeRating,
  CreateGamePayload,
  DevelopmentStage,
  GameEngine,
  GameMode,
  Genre,
  Platform,
} from '../../../contracts';

/**
 * Imagem do passo Mídias: link http(s), caminho do próprio app ou a imagem em
 * data URL — o rascunho do app guarda a imagem já reduzida assim, e a API grava
 * o arquivo (`GamesService.storeImages`).
 */
const IMAGEM = /^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+|https?:\/\/\S+|\.?\/?[\w./-]+)$/;
const IMAGEM_INVALIDA = 'Envie uma imagem PNG, JPEG ou WebP.';

/** Texto vazio vira `null`: o app manda `''` para campo de URL não preenchido. */
const vazioViraNulo = ({ value }: { value: unknown }) => (typeof value === 'string' && !value.trim() ? null : value);

/**
 * Os campos do "Novo jogo" (Figma `1180:3359` e `1187:8743`). Todos opcionais
 * menos o nome: cada passo tem "Salvar", e o que tem * é cobrado no
 * "Finalizar" (`POST /games/:id/finish-setup`).
 *
 * As listas aceitam o código ou o texto que a tela mostra ("Corrida", "Unity",
 * "Conceito"): o `@Transform` converte antes do `IsIn` conferir.
 */
export class GameFieldsDto {
  @IsOptional() @IsString() @MaxLength(160) tagline?: string;

  @IsOptional() @IsString() @MaxLength(200) shortDescription?: string;

  @IsOptional() @IsString() @MaxLength(5000) description?: string;

  @IsOptional()
  @Transform(({ value }) => toCodes(value, GENRE_ALIASES))
  @IsArray()
  @IsIn(GENRES, { each: true, message: 'Gênero fora da lista.' })
  genres?: Genre[];

  /** Tags livres: a tela oferece a mesma lista dos gêneros. */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? [...new Set(value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter(Boolean))] : value))
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  subGenres?: string[];

  @IsOptional()
  @Transform(({ value }) => toCodes(value, PLATFORM_ALIASES))
  @IsArray()
  @IsIn(PLATFORMS, { each: true, message: 'Plataforma fora da lista.' })
  platforms?: Platform[];

  @IsOptional()
  @Transform(({ value }) => toCodes(value, GAME_MODE_ALIASES))
  @IsArray()
  @IsIn(GAME_MODES, { each: true, message: 'Modo de jogo fora da lista.' })
  gameModes?: GameMode[];

  @IsOptional()
  @Transform(({ value }) => toCode(value, ENGINE_ALIASES))
  @IsIn([...ENGINES, null], { message: 'Engine fora da lista.' })
  engine?: GameEngine | null;

  @IsOptional()
  @Transform(({ value }) => toCode(value, DEV_STAGE_ALIASES))
  @IsIn([...DEV_STAGES, null], { message: 'Estágio fora da lista.' })
  developmentStage?: DevelopmentStage | null;

  @IsOptional()
  @Transform(({ value }) => toCode(value, AGE_RATING_ALIASES))
  @IsIn([...AGE_RATINGS, null], { message: 'Classificação fora da lista.' })
  ageRating?: AgeRating | null;

  @IsOptional()
  @Transform(({ value }) => toCodes(value, LANGUAGE_ALIASES))
  @IsArray()
  @IsIn(LANGUAGE_CODES, { each: true, message: 'Idioma fora da lista.' })
  languages?: string[];

  /** "Trailer / vídeo*" — YouTube, Vimeo ou qualquer link http(s). */
  @IsOptional()
  @Transform(vazioViraNulo)
  @ValidateIf((_, valor) => valor !== null)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'Informe a URL completa do vídeo (https://...).' })
  @MaxLength(500)
  trailerUrl?: string | null;

  /** "Imagem de capa*", 16:9. */
  @IsOptional()
  @Transform(vazioViraNulo)
  @ValidateIf((_, valor) => valor !== null)
  @IsString()
  @Matches(IMAGEM, { message: IMAGEM_INVALIDA })
  bannerUrl?: string;

  /** "Logo*", PNG com fundo transparente. */
  @IsOptional()
  @Transform(vazioViraNulo)
  @ValidateIf((_, valor) => valor !== null)
  @IsString()
  @Matches(IMAGEM, { message: IMAGEM_INVALIDA })
  logoUrl?: string | null;

  /** "Ícone / thumbnail*", quadrada. */
  @IsOptional()
  @Transform(vazioViraNulo)
  @ValidateIf((_, valor) => valor !== null)
  @IsString()
  @Matches(IMAGEM, { message: IMAGEM_INVALIDA })
  thumbnailUrl?: string | null;
}

export class CreateGameDto extends GameFieldsDto implements CreateGamePayload {
  @IsString()
  @IsNotEmpty({ message: 'Dê um nome ao jogo.' })
  @MaxLength(120)
  name: string;
}
