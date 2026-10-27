import type { OAuthConfig } from "next-auth/providers/oauth";
import { z } from "zod/v4";

const optionalProfileString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const feishuUserInfoSchema = z.object({
  code: z.literal(0),
  data: z.object({
    open_id: z.string().min(1),
    name: optionalProfileString,
    email: optionalProfileString,
    avatar_url: optionalProfileString,
  }),
});

type FeishuProfile = z.infer<typeof feishuUserInfoSchema>["data"];

export function FeishuProvider(options: {
  clientId: string;
  clientSecret: string;
}): OAuthConfig<FeishuProfile> {
  return {
    id: "feishu",
    name: "Feishu",
    type: "oauth",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    authorization: {
      url: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
      params: { scope: "contact:user.email:readonly" },
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
        return parsed.data.data;
      },
    },
    profile(profile) {
      return {
        id: profile.open_id,
        name: profile.name ?? null,
        email: profile.email || null,
        image: profile.avatar_url ?? null,
      };
    },
  };
}
