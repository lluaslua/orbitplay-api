import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/interfaces/jwt-payload.interface';
import { CommunityService } from './community.service';

/**
 * Porta das rotas do chat — a `communityGuard` do mock. Roda depois dos guards
 * globais, então `request.user` já está preenchido.
 */
@Injectable()
export class CommunityAccessGuard implements CanActivate {
  constructor(private readonly community: CommunityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await this.community.assertAccess(request.user, String(request.params.gameId));
    return true;
  }
}
