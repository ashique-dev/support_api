import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { RESOLUTION_QUEUE } from '../workers/workers.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message]),
    BullModule.registerQueue({ name: RESOLUTION_QUEUE }),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
