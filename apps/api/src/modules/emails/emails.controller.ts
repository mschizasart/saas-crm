import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmailsService } from './emails.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Emails')
@Controller({ version: '1', path: 'emails' })
@UseGuards(JwtAuthGuard)
export class EmailsController {
  constructor(private service: EmailsService) {}
}
