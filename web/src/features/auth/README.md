# Feishu sign-in (self-hosted)

Feishu OAuth sign-in is configured on the web service and does not require an
Enterprise license. Build the web image from this branch; the stock 3.177.0
image does not contain the Feishu provider.

1. In the Feishu developer console, open an enterprise custom app. Enable the
   `contact:user.email:readonly` and `contact:user.employee:readonly` user
   permissions, publish the app, and grant the intended users access to it.
2. Add `https://<your-langfuse-domain>/api/auth/callback/feishu` to the app's
   redirect URL allowlist. Use the same public origin as `NEXTAUTH_URL`.
3. Set these variables in the deployment's private environment file:

   ```dotenv
   NEXTAUTH_URL=https://<your-langfuse-domain>
   AUTH_FEISHU_CLIENT_ID=<app-id>
   AUTH_FEISHU_CLIENT_SECRET=<app-secret>
   # Optional: reject users of other Feishu tenants.
   AUTH_FEISHU_TENANT_KEY=<tenant-key>
   # Optional: sign in to an existing account with the same email (for example
   # an email/password account). Requires AUTH_FEISHU_TENANT_KEY.
   AUTH_FEISHU_ALLOW_ACCOUNT_LINKING=true
   # Optional: override the requested scopes (space separated).
   # AUTH_FEISHU_SCOPE=contact:user.email:readonly
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

The provider identifies accounts by Feishu `union_id`, which is the same across
all apps of a tenant, so replacing the Feishu app keeps existing accounts. The
user's email is the enterprise email (`enterprise_email`), falling back to the
contact email (`email`); a user with neither cannot sign up. By default an
existing account with the same email (for example an email/password account)
blocks Feishu sign-in. With `AUTH_FEISHU_ALLOW_ACCOUNT_LINKING=true` and
`AUTH_FEISHU_TENANT_KEY` set, Feishu signs in to that account and keeps its
roles; the password keeps working. Linking is ignored without a tenant key,
since emails are only trustworthy within the tenant whose admins assign them.
Organization invitations and project permissions still apply.

## Organization memberships without an Enterprise license

`/api/public/organizations/memberships` (GET / PUT / DELETE, organization-scoped
API key) normally requires the `admin-api` entitlement. Set
`LANGFUSE_SELF_HOSTED_MEMBERSHIP_API=true` to serve it from an open-source
implementation instead, for example to let an access-request bot grant and
revoke organization roles:

- `GET` lists `{ userId, email, name, role }` of every member.
- `PUT { userId, role }` sets the role (`ADMIN`, `MEMBER`, `VIEWER`, `NONE`) and
  adds the user to the organization if needed. The user must have signed in
  once.
- `DELETE { userId }` removes the membership and the user's project memberships
  in that organization.

OWNER memberships are never granted, changed or removed through this API.
Project-level roles are not offered: without the `rbac-project-roles`
entitlement Langfuse applies the organization role to every project. Changes
are recorded in the audit log with the API key as actor.

To have Feishu users join the organization without access until a role is
granted, set `LANGFUSE_DEFAULT_ORG_ID=<org-id>` and
`LANGFUSE_DEFAULT_ORG_ROLE=NONE`.

See Feishu's [authorization guide](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code)
and [user information reference](https://open.feishu.cn/document/server-docs/authentication-management/login-state-management/get).
