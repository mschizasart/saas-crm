import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

export interface SurveyQuestionInput {
  question: string;
  type: 'text' | 'textarea' | 'radio' | 'checkbox' | 'rating';
  options?: string[];
  required?: boolean;
  order?: number;
}

export interface CreateSurveyDto {
  name: string;
  description?: string;
  active?: boolean;
  fromName?: string;
  fromEmail?: string;
  subject?: string;
  mailText?: string;
  questions: SurveyQuestionInput[];
}

export type UpdateSurveyDto = Partial<CreateSurveyDto>;

@Injectable()
export class SurveysService {
  constructor(private prisma: PrismaService) {}

  // ─── findAll ───────────────────────────────────────────────────────────────
  async findAll(
    orgId: string,
    query: { search?: string; active?: boolean; page?: number; limit?: number },
  ) {
    const { search, active, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (active !== undefined) where.active = active;
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        tx.survey.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { submissions: true, questions: true } },
          },
        }),
        tx.survey.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────
  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const survey = await tx.survey.findFirst({
        where: { id, organizationId: orgId },
        include: {
          questions: { orderBy: { order: 'asc' } },
          _count: { select: { submissions: true } },
        },
      });
      if (!survey) throw new NotFoundException('Survey not found');
      return survey;
    });
  }

  // ─── create ────────────────────────────────────────────────────────────────
  async create(orgId: string, dto: CreateSurveyDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.survey.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          description: dto.description ?? null,
          active: dto.active ?? true,
          fromName: dto.fromName ?? null,
          fromEmail: dto.fromEmail ?? null,
          subject: dto.subject ?? null,
          mailText: dto.mailText ?? null,
          hash: randomUUID(),
          questions: {
            create: (dto.questions ?? []).map((q, i) => ({
              question: q.question,
              type: q.type,
              options: q.options ?? [],
              required: q.required ?? false,
              order: q.order ?? i,
            })),
          },
        },
        include: { questions: { orderBy: { order: 'asc' } } },
      });
    });
  }

  // ─── update ────────────────────────────────────────────────────────────────
  async update(orgId: string, id: string, dto: UpdateSurveyDto) {
    await this.findOne(orgId, id);

    return this.prisma.withOrganization(orgId, async (tx) => {
      if (dto.questions) {
        await tx.surveyQuestion.deleteMany({ where: { surveyId: id } });
        await tx.surveyQuestion.createMany({
          data: dto.questions.map((q, i) => ({
            surveyId: id,
            question: q.question,
            type: q.type,
            options: q.options ?? [],
            required: q.required ?? false,
            order: q.order ?? i,
          })),
        });
      }

      return tx.survey.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.active !== undefined && { active: dto.active }),
          ...(dto.fromName !== undefined && { fromName: dto.fromName }),
          ...(dto.fromEmail !== undefined && { fromEmail: dto.fromEmail }),
          ...(dto.subject !== undefined && { subject: dto.subject }),
          ...(dto.mailText !== undefined && { mailText: dto.mailText }),
        },
        include: { questions: { orderBy: { order: 'asc' } } },
      });
    });
  }

  // ─── delete ────────────────────────────────────────────────────────────────
  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.survey.delete({ where: { id } });
    });
  }

  // ─── getByHash (public) ────────────────────────────────────────────────────
  async getByHash(hash: string) {
    const survey = await (this.prisma as any).survey.findUnique({
      where: { hash },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!survey || !survey.active) {
      throw new NotFoundException('Survey not found or inactive');
    }
    return survey;
  }

  // ─── submit (public) ───────────────────────────────────────────────────────
  async submit(
    hashOrId: string,
    answers: Record<string, any>,
    submittedBy?: { email?: string; clientId?: string },
  ) {
    const prismaAny = this.prisma as any;
    const survey = await prismaAny.survey.findFirst({
      where: { OR: [{ id: hashOrId }, { hash: hashOrId }] },
      include: { questions: true },
    });
    if (!survey) throw new NotFoundException('Survey not found');
    if (!survey.active) throw new BadRequestException('Survey is not active');

    // Validate required questions
    for (const q of survey.questions as any[]) {
      if (q.required) {
        const val = answers[q.id];
        if (
          val === undefined ||
          val === null ||
          (typeof val === 'string' && val.trim() === '') ||
          (Array.isArray(val) && val.length === 0)
        ) {
          throw new BadRequestException(
            `Question "${q.question}" is required`,
          );
        }
      }
    }

    return prismaAny.surveySubmission.create({
      data: {
        surveyId: survey.id,
        email: submittedBy?.email ?? null,
        clientId: submittedBy?.clientId ?? null,
        answers: {
          create: (survey.questions as any[])
            .filter((q) => answers[q.id] !== undefined)
            .map((q) => ({
              questionId: q.id,
              answer: Array.isArray(answers[q.id])
                ? JSON.stringify(answers[q.id])
                : String(answers[q.id]),
            })),
        },
      },
    });
  }

  // ─── getSubmissions ────────────────────────────────────────────────────────
  async getSubmissions(
    orgId: string,
    surveyId: string,
    query: { page?: number; limit?: number },
  ) {
    await this.findOne(orgId, surveyId);
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const [data, total] = await Promise.all([
        tx.surveySubmission.findMany({
          where: { surveyId },
          skip,
          take: limit,
          orderBy: { submittedAt: 'desc' },
          include: { answers: true },
        }),
        tx.surveySubmission.count({ where: { surveyId } }),
      ]);
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── getResults ────────────────────────────────────────────────────────────
  async getResults(orgId: string, surveyId: string) {
    const survey = await this.findOne(orgId, surveyId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const submissions = await tx.surveySubmission.findMany({
        where: { surveyId },
        include: { answers: true },
      });

      const totalSubmissions = submissions.length;

      const results = (survey.questions as any[]).map((q) => {
        const answers: string[] = [];
        for (const s of submissions as any[]) {
          const a = s.answers.find((x: any) => x.questionId === q.id);
          if (a && a.answer !== null && a.answer !== undefined) {
            answers.push(a.answer);
          }
        }

        if (q.type === 'rating') {
          const nums = answers
            .map((a) => parseFloat(a))
            .filter((n) => !isNaN(n));
          const avg =
            nums.length > 0
              ? nums.reduce((sum, n) => sum + n, 0) / nums.length
              : 0;
          const distribution: Record<string, number> = {};
          for (const n of nums) {
            distribution[String(n)] = (distribution[String(n)] ?? 0) + 1;
          }
          return {
            questionId: q.id,
            question: q.question,
            type: q.type,
            totalAnswers: nums.length,
            average: avg,
            distribution,
          };
        }

        if (q.type === 'radio' || q.type === 'checkbox') {
          const counts: Record<string, number> = {};
          for (const a of answers) {
            let values: string[];
            try {
              const parsed = JSON.parse(a);
              values = Array.isArray(parsed) ? parsed : [a];
            } catch {
              values = [a];
            }
            for (const v of values) {
              counts[v] = (counts[v] ?? 0) + 1;
            }
          }
          return {
            questionId: q.id,
            question: q.question,
            type: q.type,
            totalAnswers: answers.length,
            counts,
          };
        }

        // text / textarea
        return {
          questionId: q.id,
          question: q.question,
          type: q.type,
          totalAnswers: answers.length,
          responses: answers,
        };
      });

      return { totalSubmissions, questions: results };
    });
  }
}
