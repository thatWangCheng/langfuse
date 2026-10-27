# Feishu sign-in (self-hosted)

Feishu OAuth sign-in is configured on the web service and does not require an
Enterprise license. Build the web image from this branch; the stock 3.177.0
image does not contain the Feishu provider.

1. In the Feishu developer console, open an enterprise custom app. Enable the
   `contact:user.email:readonly` user permission, publish the app, and grant the
   intended users access to it.
2. Add `https://<your-langfuse-domain>/api/auth/callback/feishu` to the app's
   redirect URL allowlist. Use the same public origin as `NEXTAUTH_URL`.
3. Set these variables in the deployment's private environment file:

   ```dotenv
   NEXTAUTH_URL=https://<your-langfuse-domain>
   AUTH_FEISHU_CLIENT_ID=<app-id>
   AUTH_FEISHU_CLIENT_SECRET=<app-secret>
   ```

4. Build and recreate the web container. With the repository's source-build
   Compose configuration:

   ```sh
   docker compose -f docker-compose.build.yml build langfuse-web
   docker compose -f docker-compose.build.yml up -d --no-deps langfuse-web
   ```

Open `/auth/sign-in` and choose **Feishu (飞书)**. The same option is available
on the sign-up page. Existing email/password and other providers keep working.
If `AUTH_DISABLE_SIGNUP=true`, only existing users can sign in.

The provider identifies accounts by Feishu `open_id`. Feishu must return a valid
contact email address via the `email` field. An enterprise mailbox alone is not
sufficient; configure the user's contact email in Feishu before signing in.
Langfuse does not automatically link an existing account by matching its email
because Feishu's contact email is not independently verified. An existing
email/password account with the same email requires an explicit account
migration before it can use Feishu. This version has no account-linking UI;
opening the sign-in page while authenticated redirects to the home page.
Organization invitations and project permissions still apply.

See Feishu's [authorization guide](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code)
and [user information reference](https://open.feishu.cn/document/server-docs/authentication-management/login-state-management/get).
