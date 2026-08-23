import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';

export async function GET(req: NextRequest | Request) {
  const auth = await requireRole(req, USER_ROLES.ADMIN);
  if (auth.user === null) return auth.response;

  const customers = await prisma.user.findMany({
    where: { role: USER_ROLES.CUSTOMER },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ customers });
}
