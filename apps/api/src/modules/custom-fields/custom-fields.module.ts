import { Module } from '@nestjs/common';
import { CustomFieldsController } from './custom-fields.controller';
import { CustomFieldsService } from './custom-fields.service';
import { ComputedFieldsService } from './computed-fields.service';

@Module({
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService, ComputedFieldsService],
  exports: [CustomFieldsService, ComputedFieldsService],
})
export class CustomFieldsModule {}
