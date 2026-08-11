import { PrismaClient } from '@prisma/client';

/**
 * A single shared Prisma client.
 *
 * Next.js hot-reloads modules in development, which would otherwise create a
 * new database connection on every file save until SQLite runs out of handles.
 * Caching the client on `globalThis` keeps exactly one instance alive.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Returns the single athlete profile, creating a placeholder if the database is
 * empty. This app is deliberately single-user: there is no login, so "the user"
 * is always the first row.
 */
export async function getUser() {
  const existing = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;

  return prisma.user.create({
    data: { name: 'Athlete', preferredUnits: 'metric' },
  });
}

/** Like {@link getUser} but returns null instead of creating anything. */
export async function findUser() {
  return prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
}
