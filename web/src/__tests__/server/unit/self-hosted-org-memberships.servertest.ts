import type * as PrismaClientModule from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";

const {
  mockUserFindUnique,
  mockMembershipFindMany,
  mockMembershipFindUnique,
  mockMembershipCreate,
  mockMembershipUpdate,
  mockMembershipDelete,
  mockAuditLog,
  mockVerifyAuth,
  mockEeGet,
  mockEnv,
} = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockMembershipFindMany: vi.fn(),
  mockMembershipFindUnique: vi.fn(),
  mockMembershipCreate: vi.fn(),
  mockMembershipUpdate: vi.fn(),
  mockMembershipDelete: vi.fn(),
  mockAuditLog: vi.fn(),
  mockVerifyAuth: vi.fn(),
  mockEeGet: vi.fn(),
  mockEnv: {} as Record<string, string | undefined>,
}));

vi.mock("@langfuse/shared/src/db", async () => {
  const { Role } =
    await vi.importActual<typeof PrismaClientModule>("@prisma/client");
  return {
    Role,
    prisma: {
      user: { findUnique: mockUserFindUnique },
      organizationMembership: {
        findMany: mockMembershipFindMany,
        findUnique: mockMembershipFindUnique,
        create: mockMembershipCreate,
        update: mockMembershipUpdate,
        delete: mockMembershipDelete,
      },
    },
  };
});
vi.mock("@/src/features/audit-logs/auditLog", () => ({
  auditLog: mockAuditLog,
}));
vi.mock("@/src/env.mjs", () => ({ env: mockEnv }));
vi.mock("@/src/features/public-api/server/apiAuth", () => ({
  ApiAuthService: class {
    verifyAuthHeaderAndReturnScope = mockVerifyAuth;
  },
}));
vi.mock("@/src/features/public-api/server/cors", () => ({
  cors: vi.fn(),
  runMiddleware: vi.fn(),
}));
vi.mock("@/src/features/public-api/server/RateLimitService", () => ({
  RateLimitService: {
    getInstance: () => ({ rateLimitRequest: async () => undefined }),
  },
}));
vi.mock("@/src/ee/features/admin-api/server/memberships", () => ({
  handleGetMemberships: mockEeGet,
  handleUpdateMembership: vi.fn(),
  handleDeleteMembership: vi.fn(),
}));

import handler from "@/src/pages/api/public/organizations/memberships";
import {
  handleSelfHostedDeleteMembership,
  handleSelfHostedGetMemberships,
  handleSelfHostedUpdateMembership,
} from "@/src/features/public-api/server/selfHostedOrgMemberships";

const scope = { orgId: "org-1", apiKeyId: "key-1" };

const mockRes = () => {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
};

const call = async (
  fn: (
    req: NextApiRequest,
    res: NextApiResponse,
    s: typeof scope,
  ) => Promise<unknown>,
  body?: unknown,
) => {
  const res = mockRes();
  await fn(
    { body } as NextApiRequest,
    res as unknown as NextApiResponse,
    scope,
  );
  return res;
};

const membership = (role: string) => ({
  id: "m-1",
  orgId: "org-1",
  userId: "u-1",
  role,
});

describe("self-hosted organization memberships", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({
      email: "user@example.com",
      name: "User",
    });
  });

  it("lists members with email and role", async () => {
    mockMembershipFindMany.mockResolvedValue([
      {
        ...membership("VIEWER"),
        user: { email: "user@example.com", name: "User" },
      },
    ]);

    const res = await call(handleSelfHostedGetMemberships);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      memberships: [
        {
          userId: "u-1",
          role: "VIEWER",
          email: "user@example.com",
          name: "User",
        },
      ],
    });
    expect(mockMembershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org-1" } }),
    );
  });

  it("updates an existing role and records an audit log", async () => {
    mockMembershipFindUnique.mockResolvedValue(membership("NONE"));
    mockMembershipUpdate.mockResolvedValue(membership("MEMBER"));

    const res = await call(handleSelfHostedUpdateMembership, {
      userId: "u-1",
      role: "MEMBER",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ userId: "u-1", role: "MEMBER" });
    expect(mockMembershipUpdate).toHaveBeenCalledWith({
      where: { id: "m-1" },
      data: { role: "MEMBER" },
    });
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "orgMembership",
        action: "update",
        orgId: "org-1",
        apiKeyId: "key-1",
      }),
    );
  });

  it("creates a membership for an existing user outside the organization", async () => {
    mockMembershipFindUnique.mockResolvedValue(null);
    mockMembershipCreate.mockResolvedValue(membership("VIEWER"));

    const res = await call(handleSelfHostedUpdateMembership, {
      userId: "u-1",
      role: "VIEWER",
    });

    expect(res.statusCode).toBe(200);
    expect(mockMembershipCreate).toHaveBeenCalledWith({
      data: { orgId: "org-1", userId: "u-1", role: "VIEWER" },
    });
  });

  it("returns 404 for an unknown user", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const res = await call(handleSelfHostedUpdateMembership, {
      userId: "missing",
      role: "VIEWER",
    });

    expect(res.statusCode).toBe(404);
    expect(mockMembershipCreate).not.toHaveBeenCalled();
  });

  it("never grants OWNER", async () => {
    const res = await call(handleSelfHostedUpdateMembership, {
      userId: "u-1",
      role: "OWNER",
    });

    expect(res.statusCode).toBe(400);
    expect(mockMembershipUpdate).not.toHaveBeenCalled();
    expect(mockMembershipCreate).not.toHaveBeenCalled();
  });

  it("does not change or remove an OWNER membership", async () => {
    mockMembershipFindUnique.mockResolvedValue(membership("OWNER"));

    const update = await call(handleSelfHostedUpdateMembership, {
      userId: "u-1",
      role: "NONE",
    });
    const remove = await call(handleSelfHostedDeleteMembership, {
      userId: "u-1",
    });

    expect(update.statusCode).toBe(403);
    expect(remove.statusCode).toBe(403);
    expect(mockMembershipUpdate).not.toHaveBeenCalled();
    expect(mockMembershipDelete).not.toHaveBeenCalled();
  });

  it("deletes a membership and returns 404 when there is none", async () => {
    mockMembershipFindUnique.mockResolvedValueOnce(membership("VIEWER"));
    const removed = await call(handleSelfHostedDeleteMembership, {
      userId: "u-1",
    });
    mockMembershipFindUnique.mockResolvedValueOnce(null);
    const missing = await call(handleSelfHostedDeleteMembership, {
      userId: "u-1",
    });

    expect(removed.statusCode).toBe(200);
    expect(mockMembershipDelete).toHaveBeenCalledWith({ where: { id: "m-1" } });
    expect(missing.statusCode).toBe(404);
  });
});

describe("organization memberships route", () => {
  const orgKey = (plan: string) => ({
    validKey: true,
    scope: {
      accessLevel: "organization",
      orgId: "org-1",
      apiKeyId: "key-1",
      plan,
    },
  });
  const request = async () => {
    const res = mockRes();
    await handler(
      {
        method: "GET",
        headers: { authorization: "Basic x" },
      } as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    return res;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete mockEnv.LANGFUSE_SELF_HOSTED_MEMBERSHIP_API;
    mockMembershipFindMany.mockResolvedValue([]);
  });

  it("keeps the plan check when the self-hosted API is off", async () => {
    mockVerifyAuth.mockResolvedValue(orgKey("oss"));

    const res = await request();

    expect(res.statusCode).toBe(403);
    expect(mockMembershipFindMany).not.toHaveBeenCalled();
  });

  it("serves the self-hosted API without the admin-api entitlement when enabled", async () => {
    mockEnv.LANGFUSE_SELF_HOSTED_MEMBERSHIP_API = "true";
    mockVerifyAuth.mockResolvedValue(orgKey("oss"));

    const res = await request();

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ memberships: [] });
    expect(mockEeGet).not.toHaveBeenCalled();
  });

  it("still requires an organization-scoped key", async () => {
    mockEnv.LANGFUSE_SELF_HOSTED_MEMBERSHIP_API = "true";
    mockVerifyAuth.mockResolvedValue({
      validKey: true,
      scope: { accessLevel: "project", orgId: "org-1", plan: "oss" },
    });

    const res = await request();

    expect(res.statusCode).toBe(403);
    expect(mockMembershipFindMany).not.toHaveBeenCalled();
  });
});
