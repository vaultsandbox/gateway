import { Module } from '@nestjs/common';
import { SseConsoleService } from './sse-console.service';
import { SseConsoleController } from './sse-console.controller';

@Module({
  controllers: [SseConsoleController],
  providers: [SseConsoleService],
  exports: [SseConsoleService], // Export for use in SmtpModule
})
export class SseConsoleModule {}
