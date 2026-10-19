import { SetMetadata } from '@nestjs/common';
import type { StudioPermission } from '../../contracts';

export const STUDIO_PERMISSION_KEY = 'studioPermission';

/**
 * Exige um nível mínimo dentro da organização: VIEW < EDIT < MANAGE
 * (Handoff, Telas 03 RN-02 e 05 RN-03). Só vale para contas de estúdio.
 */
export const RequireStudioPermission = (level: StudioPermission) =>
  SetMetadata(STUDIO_PERMISSION_KEY, level);
