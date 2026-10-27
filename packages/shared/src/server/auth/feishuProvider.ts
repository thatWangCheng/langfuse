import type { OAuthConfig } from "next-auth/providers/oauth";
import { z } from "zod/v4";

// contact:user.email:readonly returns `email`; contact:user.employee:readonly
// returns `enterprise_email`. Both must be enabled on the Feishu app.
export const FEISHU_DEFAULT_SCOPE =
  "contact:user.email:readonly contact:user.employee:readonly";

const optionalProfileString = z
  .string()
  .nullish()
  .transform((value) => value || undefined);
const feishuUserInfoSchema = z.object({
  code: z.literal(0),
  data: z.object({
    open_id: z.string().min(1),
    union_id: z.string().min(1),
    tenant_key: optionalProfileString,
    name: optionalProfileString,
    email: optionalProfileString,
    enterprise_email: optionalProfileString,
    avatar_url: optionalProfileString,
  }),
});

type FeishuProfile = z.infer<typeof feishuUserInfoSchema>["data"];

export function FeishuProvider(options: {
  clientId: string;
  clientSecret: string;
  scope?: string;
  // When set, users of any other Feishu tenant are rejected.
  tenantKey?: string;
}): OAuthConfig<FeishuProfile> {
  return {
    id: "feishu",
    name: "Feishu",
    type: "oauth",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    authorization: {
      url: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
      params: { scope: options.scope ?? FEISHU_DEFAULT_SCOPE },
    },
    token: {
      url: "https://accounts.feishu.cn/oauth/v3/token",
      async request({ client, provider, params, checks }) {
        const tokens = await client.oauthCallback(
          provider.callbackUrl,
          params,
          checks,
        );
        // Only account fields may reach NextAuth's Prisma adapter.
        return {
          tokens: {
            access_token: tokens.access_token,
            token_type: tokens.token_type,
            expires_at: tokens.expires_at,
            refresh_token: tokens.refresh_token,
            scope: tokens.scope,
          },
        };
      },
    },
    client: { token_endpoint_auth_method: "client_secret_post" },
    checks: ["pkce", "state"],
    idToken: false,
    allowDangerousEmailAccountLinking: false,
    userinfo: {
      url: "https://open.feishu.cn/open-apis/authen/v1/user_info",
      async request({ client, tokens }) {
        const response = await client.userinfo(tokens.access_token!);
        const parsed = feishuUserInfoSchema.safeParse(response);
        if (!parsed.success) throw new Error("Invalid Feishu user information");
        if (
          options.tenantKey &&
          parsed.data.data.tenant_key !== options.tenantKey
        )
          throw new Error("Feishu user belongs to another tenant");
        return parsed.data.data;
      },
    },
    profile(profile) {
      return {
        // union_id is the same across all apps of a tenant; open_id is per app.
        id: profile.union_id,
        name: profile.name ?? null,
        email: profile.enterprise_email ?? profile.email ?? null,
        image: profile.avatar_url ?? null,
      };
    },
  };
}
