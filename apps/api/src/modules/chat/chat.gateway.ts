import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
@Injectable()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger = new Logger(ChatGateway.name);

  constructor(private prisma: PrismaService) {}

  async handleConnection(socket: Socket) {
    const orgSlug = socket.handshake.query.orgSlug as string;
    const visitorId = socket.handshake.query.visitorId as string;
    if (!orgSlug) {
      socket.disconnect();
      return;
    }
    socket.data.orgSlug = orgSlug;
    socket.data.visitorId = visitorId || socket.id;
    socket.join(`chat:${orgSlug}`);
    this.logger.log(
      `Chat visitor ${socket.data.visitorId} connected to ${orgSlug}`,
    );
  }

  handleDisconnect(socket: Socket) {
    this.logger.log(`Chat visitor ${socket.data.visitorId} disconnected`);
  }

  @SubscribeMessage('message')
  async handleMessage(
    socket: Socket,
    data: { name?: string; email?: string; message: string },
  ) {
    const orgSlug = socket.data.orgSlug;
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
    });
    if (!org) return { error: 'Organization not found' };

    // Create or find ticket for this visitor session
    let ticket = await this.prisma.ticket.findFirst({
      where: {
        organizationId: org.id,
        source: 'chat',
        status: { not: 'closed' },
        // Match by looking up the visitor in replies or subject
        subject: { startsWith: `Chat from` },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Check if the ticket belongs to this visitor via a custom lookup
    // We store the visitorId in the ticket's service field for chat sessions
    if (ticket && ticket.service !== socket.data.visitorId) {
      ticket = null;
    }

    if (!ticket) {
      ticket = await this.prisma.ticket.create({
        data: {
          organizationId: org.id,
          subject: `Chat from ${data.name || 'Visitor'}`,
          message: data.message,
          status: 'open',
          priority: 'medium',
          source: 'chat',
          service: socket.data.visitorId,
          lastReplyAt: new Date(),
        },
      });
    } else {
      // Add as reply
      await this.prisma.ticketReply.create({
        data: { ticketId: ticket.id, userId: null, message: data.message },
      });
      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { lastReplyAt: new Date(), status: 'open' },
      });
    }

    // Broadcast to staff watching this org's chat
    this.server.to(`staff:${org.id}`).emit('newChatMessage', {
      ticketId: ticket.id,
      visitorId: socket.data.visitorId,
      name: data.name,
      message: data.message,
      timestamp: new Date(),
    });

    return { success: true, ticketId: ticket.id };
  }

  // Staff joins to watch chat messages
  @SubscribeMessage('joinStaff')
  async handleJoinStaff(socket: Socket, data: { orgId: string }) {
    socket.data.userId = data.orgId; // will be overridden by actual userId if provided
    socket.join(`staff:${data.orgId}`);
    this.logger.log(`Staff joined chat room for org ${data.orgId}`);
    return { success: true };
  }

  // Staff can reply to chat
  @SubscribeMessage('staffReply')
  async handleStaffReply(
    socket: Socket,
    data: { ticketId: string; message: string; orgId: string },
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: data.ticketId },
    });
    if (!ticket) return;

    await this.prisma.ticketReply.create({
      data: {
        ticketId: data.ticketId,
        userId: socket.data.userId || null,
        message: data.message,
      },
    });

    await this.prisma.ticket.update({
      where: { id: data.ticketId },
      data: { lastReplyAt: new Date(), status: 'answered' },
    });

    // Send to visitor — find org slug to broadcast to the right chat room
    const org = await this.prisma.organization.findUnique({
      where: { id: data.orgId },
    });
    if (org) {
      this.server.to(`chat:${org.slug}`).emit('reply', {
        ticketId: data.ticketId,
        message: data.message,
        from: 'staff',
        timestamp: new Date(),
      });
    }

    return { success: true };
  }
}
