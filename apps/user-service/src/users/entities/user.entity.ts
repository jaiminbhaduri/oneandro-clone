import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@oneandro/common';
import { User as PrismaUser } from '@prisma/client';

/**
 * Wraps a Prisma User row for outbound responses. `passwordHash` is
 * @Exclude()-d so the global ClassSerializerInterceptor strips it from
 * every JSON response automatically — it is structurally impossible to
 * forget to redact it on some new endpoint.
 */
export class UserEntity {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() email!: string;
  @ApiProperty() @Expose() firstName!: string;
  @ApiProperty() @Expose() lastName!: string;
  @ApiProperty({ enum: Role }) @Expose() role!: Role;
  @ApiProperty() @Expose() isEmailVerified!: boolean;
  @ApiProperty() @Expose() isActive!: boolean;
  @ApiProperty({ required: false, nullable: true }) @Expose() lastLeadStatus!: string | null;
  @ApiProperty({ required: false, nullable: true }) @Expose() lastLeadStatusAt!: Date | null;
  @ApiProperty() @Expose() createdAt!: Date;
  @ApiProperty() @Expose() updatedAt!: Date;

  @Exclude()
  passwordHash!: string;

  constructor(partial: PrismaUser) {
    Object.assign(this, partial);
  }
}
