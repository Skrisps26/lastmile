import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { registerSchema } from '@/lib/auth/schemas';
import { hashPassword } from '@/lib/auth/password';

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

export async function POST(req: NextRequest | Request) {
  const auth = await requireRole(req, USER_ROLES.ADMIN);
  if (auth.user === null) return auth.response;

  try {
    const body = await req.json();
    const validation = registerSchema.safeParse({ ...body, role: USER_ROLES.CUSTOMER });
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, email, password, phone } = validation.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'A user with this email address already exists' }, { status: 409 });
    }

    const customer = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        passwordHash: await hashPassword(password),
        role: USER_ROLES.CUSTOMER,
      },
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/customers error:', error);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
