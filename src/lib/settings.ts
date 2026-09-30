import { prisma } from "@/lib/prisma";

/** Used until an admin sets a rate (the settings row is created by a migration, so this is a fallback). */
const DEFAULT_HOURLY_RATE_CENTS = 3000;

/** The hourly rate every tutor charges, set by admins on the Admin → Rate tab. */
export async function getHourlyRateCents(): Promise<number> {
  const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
  return settings?.hourlyRateCents ?? DEFAULT_HOURLY_RATE_CENTS;
}

export async function setHourlyRateCents(hourlyRateCents: number): Promise<void> {
  await prisma.siteSettings.upsert({
    where: { id: 1 },
    update: { hourlyRateCents },
    create: { id: 1, hourlyRateCents },
  });
}
