import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { RateLimit } from '../../common/security/rate-limit.guard';
import type { AuthSession, AuthUser, LoginResult, RegisterResult } from '../../contracts';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RecoverPasswordDto } from './dto/recover-password.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendCodeDto } from './dto/resend-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto, VerifyLoginDto } from './dto/verify-email.dto';

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
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<LoginResult> {
    return this.auth.login(dto, ip);
  }

  @Public()
  @RateLimit({ limit: 10, windowMs: HORA })
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.auth.register(dto);
  }

  /** "Verifique seu e-mail". Além do limite da rota, cada código aguenta poucas tentativas erradas. */
  @Public()
  @RateLimit({ limit: 10, windowMs: HORA, by: 'ip+email' })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthSession> {
    return this.auth.verifyEmail(dto);
  }

  /** Segundo passo do login com "MFA por E-mail". */
  @Public()
  @RateLimit({ limit: 10, windowMs: HORA, by: 'ip+email' })
  @Post('verify-login')
  @HttpCode(HttpStatus.OK)
  verifyLogin(@Body() dto: VerifyLoginDto): Promise<AuthSession> {
    return this.auth.verifyLogin(dto);
  }

  @Public()
  @RateLimit({ limit: 5, windowMs: HORA, by: 'ip+email' })
  @Post('resend-code')
  @HttpCode(HttpStatus.OK)
  resendCode(@Body() dto: ResendCodeDto): Promise<{ message: string }> {
    return this.auth.resendCode(dto);
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
