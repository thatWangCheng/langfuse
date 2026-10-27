import { describe, expect, it, vi } from "vitest";
import type {
  TokenEndpointHandler,
  UserinfoEndpointHandler,
} from "next-auth/providers/oauth";
import { FeishuProvider } from "./feishuProvider";

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
    avatar_url: "https://example.com/avatar.png",
    tenant_key: "test-tenant",
  },
};

const readUserInfo = async (payload: unknown) => {
  const handler = FeishuProvider(options).userinfo as UserinfoEndpointHandler;
  return (await handler.request!({
    tokens: { access_token: "test-token" },
    client: { userinfo: async () => payload },
  } as unknown as Parameters<
    NonNullable<UserinfoEndpointHandler["request"]>
  >[0])) as FeishuProfile;
};

describe("Feishu OAuth profile", () => {
  it("unwraps user information and identifies the account by open_id", async () => {
    const profile = await readUserInfo(userInfo);

    expect(await FeishuProvider(options).profile(profile, {})).toEqual({
      id: "ou_test_user",
      name: "Test User",
      email: "user@example.com",
      image: "https://example.com/avatar.png",
    });
  });

  it("rejects an API error even when HTTP userinfo succeeds", async () => {
    await expect(
      readUserInfo({ code: 20005, msg: "Invalid access token" }),
    ).rejects.toThrow("Invalid Feishu user information");
  });

  it("rejects a profile without a stable account identifier", async () => {
    await expect(
      readUserInfo({ ...userInfo, data: { ...userInfo.data, open_id: "" } }),
    ).rejects.toThrow("Invalid Feishu user information");
  });

  it("does not invent an email address when Feishu omits it", async () => {
    const profile = await readUserInfo({
      ...userInfo,
      data: { ...userInfo.data, email: undefined },
    });

    expect(
      (await FeishuProvider(options).profile(profile, {})).email,
    ).toBeNull();
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
