import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrchestrationService } from './orchestration.service';

@Module({
  imports: [HttpModule],
  providers: [OrchestrationService],
  exports: [OrchestrationService],
})
export class OrchestrationModule {}
