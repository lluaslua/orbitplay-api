import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { RANKING_PERIODS, TEST_LOCATIONS } from '../../../common/constants/domain.constants';
import type { RankingPeriod, TestLocation, UpdatePlayerProfilePayload } from '../../../contracts';

/** "Global" é público do teste, não lugar de alguém: o jogador escolhe Brasil ou EUA. */
const LUGARES = TEST_LOCATIONS.filter((lugar) => lugar !== 'GLOBAL');

export class UpdatePlayerProfileDto implements UpdatePlayerProfilePayload {
  @IsOptional()
  @IsIn(LUGARES)
  location?: TestLocation;

  /** AAAA-MM-DD. */
  @IsOptional()
  @IsDateString({}, { message: 'Informe a data no formato AAAA-MM-DD.' })
  birthDate?: string;
}

export class RankingQueryDto {
  @IsOptional()
  @IsIn(RANKING_PERIODS)
  period?: RankingPeriod;
}
