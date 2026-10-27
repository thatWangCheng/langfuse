import { fireEvent, render, screen } from "@testing-library/react";
import {
  getServerSideProps,
  SSOButtons,
  type PageProps,
} from "@/src/pages/auth/sign-in";
import type { GetServerSidePropsContext } from "next";

const { signInMock, testEnv } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  testEnv: {} as Record<string, string | undefined>,
}));

vi.mock("next-auth/react", () => ({ signIn: signInMock }));
vi.mock("@/src/env.mjs", () => ({ env: testEnv }));
vi.mock("@/src/components/LangfuseLogo", () => ({
  LangfuseIcon: () => null,
}));
vi.mock("@/src/ee/features/multi-tenant-sso/utils", () => ({
  isAnySsoConfigured: async () => false,
}));
vi.mock("@/src/features/posthog-analytics/usePostHogClientCapture", () => ({
  usePostHogClientCapture: () => vi.fn(),
}));
vi.mock("@/src/features/auth/components/AuthCloudRegionSwitch", () => ({
  CloudRegionSwitch: () => null,
}));
vi.mock("@/src/features/auth/components/AuthCloudPrivacyNotice", () => ({
  CloudPrivacyNotice: () => null,
}));

const authProviders: PageProps["authProviders"] = {
  credentials: false,
  google: false,
  github: false,
  githubEnterprise: false,
  gitlab: false,
  okta: false,
  authentik: false,
  onelogin: false,
  azureAd: false,
  auth0: false,
  clickhouseCloud: false,
  cognito: false,
  keycloak: false,
  workos: false,
  wordpress: false,
  custom: false,
  sso: false,
  feishu: false,
};

describe("Feishu sign-in", () => {
  beforeEach(() => {
    signInMock.mockReset();
    signInMock.mockResolvedValue(undefined);
    for (const key of Object.keys(testEnv)) delete testEnv[key];
  });

  it.each([undefined, "test-secret"])(
    "enables the button only with complete server credentials (secret: %s)",
    async (secret) => {
      testEnv.AUTH_FEISHU_CLIENT_ID = "test-app";
      testEnv.AUTH_FEISHU_CLIENT_SECRET = secret;

      expect(
        await getServerSideProps({} as GetServerSidePropsContext),
      ).toMatchObject({
        props: { authProviders: { feishu: secret !== undefined } },
      });
    },
  );

  it("hides Feishu sign-in when it is not configured", () => {
    render(<SSOButtons authProviders={authProviders} />);

    expect(
      screen.queryByRole("button", { name: /Feishu/ }),
    ).not.toBeInTheDocument();
  });

  it("starts Feishu sign-in while password authentication is disabled", () => {
    render(<SSOButtons authProviders={{ ...authProviders, feishu: true }} />);

    fireEvent.click(screen.getByRole("button", { name: /Feishu/ }));

    expect(signInMock).toHaveBeenCalledWith("feishu");
  });
});
