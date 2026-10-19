import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';
import { PLAYER_TYPE_IDS, TEST_MODELS, TEST_SLOTS } from '../../../common/constants/domain.constants';
import type { PlayerTypeId, QuoteRequest, TestModel } from '../../../contracts';

export class QuoteDto implements QuoteRequest {
  @IsIn(TEST_MODELS)
  model: TestModel;

  @IsIn(PLAYER_TYPE_IDS)
  playerType: PlayerTypeId;

  @IsBoolean()
  boost: boolean;

  @IsInt()
  @Min(TEST_SLOTS.min)
  @Max(TEST_SLOTS.max)
  slots: number;

  @IsBoolean()
  untilDisabled: boolean;

  @IsInt()
  @Min(0)
  rewardPerSessionCents: number;

  @IsInt()
  @Min(1)
  @Max(365)
  durationDays: number;
}
