import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { InboxModule } from '../inbox/inbox.module';
import { ApiKeyGuard } from '../inbox/guards/api-key.guard';

/**
 * @module EventsModule
 * @description This module encapsulates the functionality for handling server-sent events (SSE).
 * It imports the InboxModule to access inbox-related services and guards.
 * It provides the EventsService for other parts of the application to emit events.
 */
@Module({
  imports: [InboxModule],
  controllers: [EventsController],
  providers: [EventsService, ApiKeyGuard],
  exports: [EventsService],
})
export class EventsModule {}
