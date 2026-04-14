import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TodosService } from './todos.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Todos')
@Controller({ version: '1', path: 'todos' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TodosController {
  constructor(private service: TodosService) {}

  @Get()
  findMine(@CurrentOrg() org: any, @CurrentUser() user: any) {
    return this.service.findMine(user.id, org.id);
  }

  @Post()
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() body: { content: string },
  ) {
    return this.service.create(user.id, org.id, body.content);
  }

  @Patch('reorder')
  reorder(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() body: { ids: string[] },
  ) {
    return this.service.reorder(user.id, org.id, body.ids);
  }

  @Patch(':id/toggle')
  toggle(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.toggle(user.id, org.id, id);
  }

  @Patch(':id')
  update(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.service.update(user.id, org.id, id, body.content);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.delete(user.id, org.id, id);
  }
}
