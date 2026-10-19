import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { CLIENT_PLATFORM_HEADER, clientPlatform } from '../../common/utils/platform';
import type {
  Achievement,
  AvailableTest,
  GameAchievement,
  Participation,
  PlayerDashboard,
  PlayerGameHistory,
  PlayerGameTest,
  PlayerRanking,
  PlayerSessionReview,
  SessionOutcome,
  SessionResult,
} from '../../contracts';
import { RankingQueryDto, UpdatePlayerProfileDto } from './dto/player-profile.dto';
import { SessionLookupDto } from './dto/session-lookup.dto';
import { SubmitSessionDto } from './dto/submit-session.dto';
import { ParticipationService } from './participation.service';
import { PlayerService } from './player.service';

/** Tudo o que só o tester vê. O jogador é sempre o do token — nenhuma rota recebe playerId. */
@Roles('PLAYER')
@Controller('player')
export class PlayerController {
  constructor(
    private readonly player: PlayerService,
    private readonly participations: ParticipationService,
  ) {}

  /**
   * O app manda `X-Client-Platform` (win32, darwin, linux...) em todas as
   * rotas do jogador: é o que marca "Indisponível para seu dispositivo".
   */
  @Get('dashboard')
  dashboard(@CurrentUser() user: RequestUser, @Headers(CLIENT_PLATFORM_HEADER) platform?: string): Promise<PlayerDashboard> {
    return this.player.getDashboard(user.id, clientPlatform(platform));
  }

  @Get('catalog')
  catalog(@CurrentUser() user: RequestUser, @Headers(CLIENT_PLATFORM_HEADER) platform?: string): Promise<AvailableTest[]> {
    return this.player.getCatalog(user.id, undefined, clientPlatform(platform));
  }

  /** Card "Missões e Ranking": `?period=week|month|all`. */
  @Get('ranking')
  ranking(@CurrentUser() user: RequestUser, @Query() { period }: RankingQueryDto): Promise<PlayerRanking> {
    return this.player.getRanking(user.id, period ?? 'week');
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdatePlayerProfileDto): Promise<{ location: string; birthDate: string | null }> {
    return this.player.updateProfile(user.id, dto);
  }

  @Post('tutorial/seen')
  @HttpCode(HttpStatus.OK)
  tutorialSeen(@CurrentUser() user: RequestUser): Promise<{ tutorialSeen: true; seenAt: string }> {
    return this.player.markTutorialSeen(user.id);
  }

  @Get('participations')
  listParticipations(@CurrentUser() user: RequestUser): Promise<Participation[]> {
    return this.player.listParticipations(user.id);
  }

  @Get('achievements')
  achievements(@CurrentUser() user: RequestUser): Promise<Achievement[]> {
    return this.player.listAchievements(user.id);
  }

  @Get('games/:gameId/tests')
  gameTests(
    @CurrentUser() user: RequestUser,
    @Param('gameId') gameId: string,
    @Headers(CLIENT_PLATFORM_HEADER) platform?: string,
  ): Promise<PlayerGameTest[]> {
    return this.player.listGameTests(user.id, gameId, clientPlatform(platform));
  }

  @Get('games/:gameId/achievements')
  gameAchievements(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string): Promise<GameAchievement[]> {
    return this.player.listGameAchievements(user.id, gameId);
  }

  @Get('games/:gameId/history')
  gameHistory(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string): Promise<PlayerGameHistory[]> {
    return this.player.listGameHistory(user.id, gameId);
  }

  @Get('session-review')
  sessionReview(@CurrentUser() user: RequestUser, @Query() { testId }: SessionLookupDto): Promise<PlayerSessionReview> {
    return this.player.getSessionReview(user.id, testId);
  }

  @Get('session-outcome')
  sessionOutcome(@CurrentUser() user: RequestUser, @Query() { testId }: SessionLookupDto): Promise<SessionOutcome> {
    return this.player.getSessionOutcome(user.id, testId);
  }

  @Post('tests/:testId/start')
  start(
    @CurrentUser() user: RequestUser,
    @Param('testId') testId: string,
    @Headers(CLIENT_PLATFORM_HEADER) platform?: string,
  ): Promise<Participation> {
    return this.participations.start(user, testId, clientPlatform(platform));
  }

  @Idempotent()
  @Post('tests/:testId/submit')
  submit(
    @CurrentUser() user: RequestUser,
    @Param('testId') testId: string,
    @Body() dto: SubmitSessionDto,
  ): Promise<SessionResult> {
    return this.participations.submit(user, testId, dto);
  }
}
