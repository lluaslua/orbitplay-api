import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ARCHETYPE_IDS,
  AUDIENCE_AGE,
  GRID_QUESTION_TYPES,
  MIN_GRID_COLUMNS,
  MIN_QUESTION_OPTIONS,
  OPTION_QUESTION_TYPES,
  PLAYER_TYPE_IDS,
  QUESTION_TYPES,
  TEST_LOCATIONS,
  TEST_MODELS,
  TEST_SLOTS,
} from '../../../common/constants/domain.constants';
import type {
  ArchetypeId,
  FormQuestion,
  PlayerTypeId,
  Playtest,
  PlaytestAudience,
  PlaytestBudget,
  QuestionType,
  TestLocation,
  TestModel,
} from '../../../contracts';

export class FormQuestionDto implements FormQuestion {
  @IsString()
  id: string;

  @IsIn(QUESTION_TYPES)
  type: QuestionType;

  /** O stepper só avança com 5 caracteres ou mais. */
  @IsString()
  @MinLength(5)
  label: string;

  @IsOptional()
  @IsString()
  helperText?: string;

  @IsBoolean()
  required: boolean;

  /** Data URL WebP, já reduzida no app — por isso o limite de 5 MB no main.ts. */
  @IsOptional()
  @IsString()
  imageUrl?: string;

  /**
   * Só é conferida nos tipos de escolha: o app cria toda pergunta com
   * `options: []`, inclusive as de texto.
   */
  @ValidateIf((pergunta: FormQuestionDto) => OPTION_QUESTION_TYPES.includes(pergunta.type))
  @IsArray()
  @ArrayMinSize(MIN_QUESTION_OPTIONS, {
    message: `Adicione pelo menos ${MIN_QUESTION_OPTIONS} opções.`,
  })
  @IsString({ each: true })
  options?: string[];

  /** Só nas grades: as colunas. As linhas (`options`) são conferidas no service. */
  @ValidateIf((pergunta: FormQuestionDto) => GRID_QUESTION_TYPES.includes(pergunta.type) || pergunta.columns !== undefined)
  @IsArray()
  @ArrayMinSize(MIN_GRID_COLUMNS, { message: `Adicione pelo menos ${MIN_GRID_COLUMNS} colunas.` })
  @IsString({ each: true })
  columns?: string[];

  @IsOptional()
  @IsInt()
  scaleMin?: number;

  @IsOptional()
  @IsInt()
  scaleMax?: number;

  @IsOptional()
  @IsString()
  scaleMinLabel?: string;

  @IsOptional()
  @IsString()
  scaleMaxLabel?: string;
}

/** Mínimo ≤ máximo é conferido no service: o class-validator não compara dois campos. */
export class PlaytestAudienceDto implements PlaytestAudience {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(TEST_LOCATIONS, { each: true })
  locations: TestLocation[];

  @IsIn(PLAYER_TYPE_IDS)
  playerType: PlayerTypeId;

  @IsIn(ARCHETYPE_IDS)
  archetype: ArchetypeId;

  @IsInt()
  @Min(AUDIENCE_AGE.min)
  @Max(AUDIENCE_AGE.max)
  minAge: number;

  @IsInt()
  @Min(AUDIENCE_AGE.min)
  @Max(AUDIENCE_AGE.max)
  maxAge: number;
}

/** Valores em centavos. Os preços chegam só como referência — o service refaz a conta. */
export class PlaytestBudgetDto implements PlaytestBudget {
  @IsInt()
  @Min(TEST_SLOTS.min)
  @Max(TEST_SLOTS.max)
  slots: number;

  @IsBoolean()
  untilDisabled: boolean;

  @IsInt()
  @Min(0)
  basePriceCents: number;

  @IsInt()
  @Min(0)
  audienceCents: number;

  @IsInt()
  @Min(0)
  boostCents: number;

  @IsInt()
  @Min(0)
  pricePerTestCents: number;

  @IsInt()
  @Min(0)
  totalCents: number;

  @IsInt()
  @Min(0)
  rewardPerSessionCents: number;

  @IsInt()
  @Min(1)
  durationDays: number;
}

/** O que `useCreateTest` manda ao publicar o rascunho do stepper (TELAS 06-10). */
type CreatePlaytestPayload = Pick<
  Playtest,
  | 'gameId'
  | 'model'
  | 'title'
  | 'instructions'
  | 'questions'
  | 'requiresRecording'
  | 'requiresMicrophone'
  | 'requiresWebcam'
  | 'audience'
  | 'budget'
>;

export class CreatePlaytestDto implements CreatePlaytestPayload {
  @IsString()
  gameId: string;

  @IsIn(TEST_MODELS)
  model: TestModel;

  /** A etapa 2 do Figma não desenha título nem instruções: podem chegar vazios. */
  @IsString()
  @MaxLength(160)
  title: string;

  @IsString()
  @MaxLength(5000)
  instructions: string;

  /** A ordem do array é a ordem das perguntas e precisa ser gravada assim (Tela 07, RN-03). */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => FormQuestionDto)
  questions: FormQuestionDto[];

  @IsBoolean()
  requiresRecording: boolean;

  @IsBoolean()
  requiresMicrophone: boolean;

  @IsBoolean()
  requiresWebcam: boolean;

  /** "Jogável com controle*" da etapa 3. Opcional para o app antigo, que não manda. */
  @IsOptional()
  @IsBoolean()
  requiresController?: boolean;

  /** Só jogadores ELITE — aparece em "Exclusivos ELITE". */
  @IsOptional()
  @IsBoolean()
  eliteOnly?: boolean;

  @ValidateNested()
  @Type(() => PlaytestAudienceDto)
  audience: PlaytestAudienceDto;

  @ValidateNested()
  @Type(() => PlaytestBudgetDto)
  budget: PlaytestBudgetDto;

  /**
   * A build enviada na etapa 3 (`POST /games/:gameId/builds`). Obrigatória,
   * menos no A/B de imagens, que não usa build jogável (Tela 08, RN-01).
   */
  @IsOptional()
  @IsString()
  buildId?: string;

  /** O app de hoje manda nome e tamanho porque simula o upload; a API usa os da build. */
  @IsOptional()
  @IsString()
  buildFileName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  buildSizeMb?: number;
}
