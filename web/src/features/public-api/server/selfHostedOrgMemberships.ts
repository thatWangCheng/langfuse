import { type NextApiRequest, type NextApiResponse } from "next";
import { z } from "zod/v4";
import { prisma, Role } from "@langfuse/shared/src/db";
import { auditLog } from "@/src/features/audit-logs/auditLog";

// Organization membership management for self-hosted instances without the
// admin-api entitlement, enabled by LANGFUSE_SELF_HOSTED_MEMBERSHIP_API=true.
// Same contract as /api/public/organizations/memberships. Organization roles
// only: without rbac-project-roles, project roles are not enforced anyway.
// OWNER memberships are never granted, changed or removed here; manage owners
// in the UI.

const UpdateMembershipBody = z.object({
  userId: z.string().min(1),
  role: z.enum([Role.ADMIN, Role.MEMBER, Role.VIEWER, Role.NONE]),
});

const DeleteMembershipBody = z.object({
  userId: z.string().min(1),
});

type Scope = { orgId: string; apiKeyId: string };

const ownerProtected = (res: NextApiResponse) =>
  res.status(403).json({
    error: "OWNER memberships cannot be changed through the API.",
  });

export async function handleSelfHostedGetMemberships(
  _req: NextApiRequest,
  res: NextApiResponse,
  { orgId }: Scope,
) {
  const memberships = await prisma.organizationMembership.findMany({
    where: { orgId },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return res.status(200).json({
    memberships: memberships.map((m) => ({
      userId: m.userId,
      role: m.role,
      email: m.user.email,
      name: m.user.name,
    })),
  });
}

export async function handleSelfHostedUpdateMembership(
  req: NextApiRequest,
  res: NextApiResponse,
  { orgId, apiKeyId }: Scope,
) {
  const body = UpdateMembershipBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: body.error.issues,
    });
  }
  const { userId, role } = body.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const existing = await prisma.organizationMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (existing?.role === Role.OWNER) return ownerProtected(res);

  const membership = existing
    ? await prisma.organizationMembership.update({
        where: { id: existing.id },
        data: { role },
      })
    : await prisma.organizationMembership.create({
        data: { orgId, userId, role },
      });

  await auditLog({
    resourceType: "orgMembership",
    resourceId: membership.id,
    action: existing ? "update" : "create",
    orgId,
    apiKeyId,
    before: existing ?? undefined,
    after: membership,
  });

  return res.status(200).json({
    userId,
    role: membership.role,
    email: user.email,
    name: user.name,
  });
}

export async function handleSelfHostedDeleteMembership(
  req: NextApiRequest,
  res: NextApiResponse,
  { orgId, apiKeyId }: Scope,
) {
  const body = DeleteMembershipBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: body.error.issues,
    });
  }
  const { userId } = body.data;

  const existing = await prisma.organizationMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (!existing) {
    return res.status(404).json({ error: "Membership not found" });
  }
  if (existing.role === Role.OWNER) return ownerProtected(res);

  // Cascades to the user's project memberships in this organization.
  await prisma.organizationMembership.delete({ where: { id: existing.id } });

  await auditLog({
    resourceType: "orgMembership",
    resourceId: existing.id,
    action: "delete",
    orgId,
    apiKeyId,
    before: existing,
  });

  return res.status(200).json({
    message: "Membership deleted successfully",
    userId,
  });
}
