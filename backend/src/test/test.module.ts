import { Module } from '@nestjs/common';
import { TestController } from './test.controller';
import { TestEmailService } from './test-email.service';
import { InboxModule } from '../inbox/inbox.module';
import { CryptoModule } from '../crypto/crypto.module';
import { SmtpModule } from '../smtp/smtp.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [InboxModule, CryptoModule, SmtpModule, EventsModule],
  controllers: [TestController],
  providers: [TestEmailService],
})
export class TestModule {}
