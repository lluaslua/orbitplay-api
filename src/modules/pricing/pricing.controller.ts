import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import type { PlaytestBudget, PricingCatalog } from '../../contracts';
import { QuoteDto } from './dto/quote.dto';
import { PricingService } from './pricing.service';

/** Etapas 1 e 4 do Novo teste. */
@Roles('STUDIO')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('catalog')
  catalog(): Promise<PricingCatalog> {
    return this.pricing.catalog();
  }

  /** A etapa 4 chama a cada mudança que afeta o preço. */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(@Body() dto: QuoteDto): Promise<PlaytestBudget> {
    return this.pricing.quote(dto);
  }
}
