import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SuggestionsService } from './suggestions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Suggestions')
@Controller({ version: '1', path: 'suggestions' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SuggestionsController {
  constructor(private service: SuggestionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get smart suggestions / nudges' })
  getSuggestions(@CurrentOrg() org: any, @CurrentUser() user: any) {
    return this.service.getSuggestions(org.id, user.id);
  }
}
