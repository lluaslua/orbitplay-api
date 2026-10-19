import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { AuthSession, AuthUser } from '../../contracts';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RecoverPasswordDto } from './dto/recover-password.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthSession> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthSession> {
    return this.auth.register(dto);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.me(user);
  }

  /**
   * Pública: o app apaga o token antes de chamar (authStore.logout), e o JWT
   * não guarda estado no servidor para desfazer.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(): { success: true } {
    return { success: true };
  }

  @Public()
  @Post('recover')
  @HttpCode(HttpStatus.OK)
  recover(@Body() dto: RecoverPasswordDto): Promise<{ message: string }> {
    return this.auth.recover(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.auth.resetPassword(dto);
  }
}
