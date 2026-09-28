import { Injectable } from '@nestjs/common';
import { Athlete } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AthleteDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Athlete | null> {
    return this.prisma.athlete.findUnique({ where: { id } });
  }
}
