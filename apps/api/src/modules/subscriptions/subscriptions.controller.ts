import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Subscriptions')
@Controller({ version: '1', path: 'subscriptions' })
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private service: SubscriptionsService) {}
}
