import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { RateLimit } from '../../common/security/rate-limit.guard';
import type { AuthSession, AuthUser } from '../../contracts';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RecoverPasswordDto } from './dto/recover-password.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Limites: por IP+e-mail e por IP. O bloqueio da conta (falhas seguidas) fica no service. */
  @Public()
  @RateLimit({ limit: 10, windowMs: MINUTO, by: 'ip+email' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<AuthSession> {
    return this.auth.login(dto, ip);
  }

  @Public()
  @RateLimit({ limit: 10, windowMs: HORA })
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthSession> {
    return this.auth.register(dto);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.me(user);
  }

  /**
   * Revoga o token apresentado (o `jti` entra na lista de revogados até ele
   * vencer). Pública para que um token já vencido não gere erro na saída.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Headers('authorization') authorization?: string): Promise<{ success: true }> {
    await this.auth.logout(authorization);
    return { success: true };
  }

  @Public()
  @RateLimit({ limit: 5, windowMs: HORA, by: 'ip+email' })
  @Post('recover')
  @HttpCode(HttpStatus.OK)
  recover(@Body() dto: RecoverPasswordDto): Promise<{ message: string }> {
    return this.auth.recover(dto);
  }

  @Public()
  @RateLimit({ limit: 10, windowMs: HORA })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.auth.resetPassword(dto);
  }
}
