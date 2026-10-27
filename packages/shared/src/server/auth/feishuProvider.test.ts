import { describe, expect, it, vi } from "vitest";
import type {
  TokenEndpointHandler,
  UserinfoEndpointHandler,
} from "next-auth/providers/oauth";
import { FEISHU_DEFAULT_SCOPE, FeishuProvider } from "./feishuProvider";

const options = { clientId: "test-app", clientSecret: "test-secret" };
type FeishuProfile = Parameters<
  ReturnType<typeof FeishuProvider>["profile"]
>[0];
const userInfo = {
  code: 0,
  msg: "success",
  data: {
    open_id: "ou_test_user",
    union_id: "on_test_user",
    name: "Test User",
    email: "user@example.com",
    enterprise_email: "user@corp.example.com",
    avatar_url: "https://example.com/avatar.png",
    tenant_key: "test-tenant",
  },
};

const readUserInfo = async (
  payload: unknown,
  providerOptions: Parameters<typeof FeishuProvider>[0] = options,
) => {
  const handler = FeishuProvider(providerOptions)
    .userinfo as UserinfoEndpointHandler;
  return (await handler.request!({
    tokens: { access_token: "test-token" },
    client: { userinfo: async () => payload },
  } as unknown as Parameters<
    NonNullable<UserinfoEndpointHandler["request"]>
  >[0])) as FeishuProfile;
};

const withData = (data: Record<string, unknown>) => ({
  ...userInfo,
  data: { ...userInfo.data, ...data },
});

describe("Feishu OAuth profile", () => {
  it("unwraps user information, identifies the account by union_id and prefers the enterprise email", async () => {
    const profile = await readUserInfo(userInfo);

    expect(await FeishuProvider(options).profile(profile, {})).toEqual({
      id: "on_test_user",
      name: "Test User",
      email: "user@corp.example.com",
      image: "https://example.com/avatar.png",
    });
  });

  it("falls back to the contact email without an enterprise email", async () => {
    const profile = await readUserInfo(withData({ enterprise_email: "" }));

    expect((await FeishuProvider(options).profile(profile, {})).email).toBe(
      "user@example.com",
    );
  });

  it("rejects an API error even when HTTP userinfo succeeds", async () => {
    await expect(
      readUserInfo({ code: 20005, msg: "Invalid access token" }),
    ).rejects.toThrow("Invalid Feishu user information");
  });

  it("rejects a profile without a stable account identifier", async () => {
    await expect(readUserInfo(withData({ union_id: "" }))).rejects.toThrow(
      "Invalid Feishu user information",
    );
  });

  it("does not invent an email address when Feishu omits both", async () => {
    const profile = await readUserInfo(
      withData({ email: undefined, enterprise_email: null }),
    );

    expect(
      (await FeishuProvider(options).profile(profile, {})).email,
    ).toBeNull();
  });

  it("rejects users of another tenant when a tenant key is configured", async () => {
    const restricted = { ...options, tenantKey: "test-tenant" };

    await expect(
      readUserInfo(withData({ tenant_key: "other-tenant" }), restricted),
    ).rejects.toThrow("Feishu user belongs to another tenant");
    await expect(readUserInfo(userInfo, restricted)).resolves.toMatchObject({
      union_id: "on_test_user",
    });
  });

  it("checks state without PKCE", () => {
    expect(FeishuProvider(options).checks).toEqual(["state"]);
  });

  it("requests both email scopes unless configured otherwise", () => {
    const scopeOf = (provider: ReturnType<typeof FeishuProvider>) =>
      (provider.authorization as { params: { scope: string } }).params.scope;

    expect(scopeOf(FeishuProvider(options))).toBe(FEISHU_DEFAULT_SCOPE);
    expect(
      scopeOf(
        FeishuProvider({ ...options, scope: "contact:user.email:readonly" }),
      ),
    ).toBe("contact:user.email:readonly");
  });
});

describe("Feishu OAuth token exchange", () => {
  const params = { code: "test-code", state: "test-state" };
  const checks = { state: "test-state", code_verifier: "test-verifier" };

  it("forwards OAuth checks and keeps only account-compatible token fields", async () => {
    const provider = FeishuProvider(options);
    const oauthCallback = vi.fn(async () => ({
      code: 0,
      access_token: "test-token",
      token_type: "Bearer",
      expires_at: 1800000000,
      scope: "contact:user.email:readonly",
      refresh_token: "test-refresh-token",
      unexpected_field: "not-an-account-field",
    }));
    const callbackUrl = "https://example.com/api/auth/callback/feishu";
    const endpoint = provider.token as TokenEndpointHandler;
    const context = {
      provider: { ...provider, callbackUrl },
      params,
      checks,
      client: { oauthCallback },
    } as unknown as Parameters<NonNullable<TokenEndpointHandler["request"]>>[0];
    const { tokens } = endpoint.request
      ? await endpoint.request(context)
      : { tokens: await oauthCallback() };

    expect(tokens).toEqual({
      access_token: "test-token",
      token_type: "Bearer",
      expires_at: 1800000000,
      scope: "contact:user.email:readonly",
      refresh_token: "test-refresh-token",
    });
    expect(oauthCallback).toHaveBeenCalledWith(callbackUrl, params, checks);
  });
});
