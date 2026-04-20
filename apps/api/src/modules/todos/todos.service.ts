import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class TodosService {
  constructor(private prisma: PrismaService) {}

  async findMine(userId: string, orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.todo.findMany({
        where: { organizationId: orgId, userId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });
    });
  }

  async create(userId: string, orgId: string, content: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const count = await tx.todo.count({
        where: { organizationId: orgId, userId },
      });
      return tx.todo.create({
        data: {
          organizationId: orgId,
          userId,
          description: content,
          order: count,
        },
      });
    });
  }

  private async ownedTodo(tx: any, userId: string, orgId: string, id: string) {
    const todo = await tx.todo.findFirst({ where: { id, organizationId: orgId } });
    if (!todo || todo.userId !== userId) {
      throw new NotFoundException('Todo not found');
    }
    return todo;
  }

  async toggle(userId: string, orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const todo = await this.ownedTodo(tx, userId, orgId, id);
      return tx.todo.update({
        where: { id },
        data: { completed: !todo.completed },
      });
    });
  }

  async update(userId: string, orgId: string, id: string, content: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      await this.ownedTodo(tx, userId, orgId, id);
      return tx.todo.update({
        where: { id },
        data: { description: content },
      });
    });
  }

  async delete(userId: string, orgId: string, id: string) {
    await this.prisma.withOrganization(orgId, async (tx) => {
      await this.ownedTodo(tx, userId, orgId, id);
      await tx.todo.delete({ where: { id } });
    });
  }

  async reorder(userId: string, orgId: string, ids: string[]) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      await Promise.all(
        ids.map((id, index) =>
          tx.todo.updateMany({
            where: { id, userId, organizationId: orgId },
            data: { order: index },
          }),
        ),
      );
      return tx.todo.findMany({
        where: { organizationId: orgId, userId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });
    });
  }
}
