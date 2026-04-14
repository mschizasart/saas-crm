import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/notifications',
})
@Injectable()
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(NotificationsGateway.name);
  // Map userId → Set of socketIds
  private userSockets = new Map<string, Set<string>>();

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token =
        socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        socket.disconnect();
        return;
      }
      const payload: any = this.jwt.verify(token as string, {
        secret: this.config.get('JWT_SECRET'),
      });
      const userId = payload.sub;
      if (!userId) {
        socket.disconnect();
        return;
      }
      socket.data.userId = userId;
      socket.data.orgId = payload.orgId;
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(socket.id);
      if (payload.orgId) {
        socket.join(`org:${payload.orgId}`);
      }
      this.logger.log(`User ${userId} connected (socket ${socket.id})`);
    } catch (e: any) {
      this.logger.warn(`Socket connection rejected: ${e.message}`);
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket) {
    const userId = socket.data.userId;
    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId)!.delete(socket.id);
      if (this.userSockets.get(userId)!.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  // Emit to a specific user (all their connected sockets)
  emitToUser(userId: string, event: string, data: any) {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    for (const socketId of sockets) {
      this.server.to(socketId).emit(event, data);
    }
  }

  // Emit to everyone in an organization
  emitToOrg(orgId: string, event: string, data: any) {
    this.server.to(`org:${orgId}`).emit(event, data);
  }

  // Listen for notification.created events and push to the target user
  @OnEvent('notification.created')
  async handleNotificationCreated(payload: { notification: any }) {
    if (!payload?.notification?.userId) return;
    this.emitToUser(
      payload.notification.userId,
      'notification',
      payload.notification,
    );
  }

  // Listen for activity.created to push live activity feed updates to org
  @OnEvent('activity.created')
  async handleActivityCreated(payload: { activity: any; orgId: string }) {
    if (!payload?.orgId) return;
    this.emitToOrg(payload.orgId, 'activity', payload.activity);
  }
}
