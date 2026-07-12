import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssignableRole } from '../common/enums/role.enum';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async create(input: CreateUserInput): Promise<User> {
    const email = this.normalizeEmail(input.email);

    try {
      return await this.prisma.user.create({
        data: {
          email,
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: this.normalizeEmail(email) } });
  }

  async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<User> {
    await this.findByIdOrThrow(id);
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
      },
    });
  }

  async setRole(id: string, role: AssignableRole): Promise<User> {
    await this.findByIdOrThrow(id);
    return this.prisma.user.update({ where: { id }, data: { role } });
  }

  async deactivate(id: string): Promise<User> {
    await this.findByIdOrThrow(id);
    return this.prisma.user.update({ where: { id }, data: { isActive: false } });
  }

  async list(query: ListUsersQueryDto): Promise<PaginatedResult<User>> {
    const where: Prisma.UserWhereInput = query.role ? { role: query.role } : {};
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, skip, take: query.pageSize, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** Invoked by the lead-status-events Kafka consumer to keep the read-model projection fresh. */
  async recordLeadStatus(userId: string, status: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { lastLeadStatus: status, lastLeadStatusAt: new Date() },
    });
  }
}
