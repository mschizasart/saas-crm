import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreditNotesService } from './credit-notes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('CreditNotes')
@Controller({ version: '1', path: 'credit-notes' })
@UseGuards(JwtAuthGuard)
export class CreditNotesController {
  constructor(private service: CreditNotesService) {}
}
