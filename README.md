# SV_DASHBOARD_PROTO

Source code for the labor-compliance dashboard and its API service.

## Development

Install dependencies from the repository root:

```sh
pnpm install
```

Start the web app and API server in separate terminals:

```sh
pnpm --filter @workspace/labor-compliance run dev
```

```sh
pnpm --filter @workspace/api-server run dev
```

## Configuration

For Azure SQL with Microsoft Entra service-principal authentication, configure
`AZURE_AUTH_MODE`, `AZURE_CONNECTION_STRING`, `AZURE_ENTRA_TENANT_ID`,
`AZURE_ENTRA_CLIENT_ID`, and `AZURE_ENTRA_CLIENT_SECRET` in the deployment's
secret manager. The connection string should identify the server and database;
do not put credentials in it when using service-principal mode.

Development sign-in may also require the Clerk variables listed in
`.env.example`. Store real values in Replit Secrets or another secret manager.
Never commit `.env` files or real credentials.
