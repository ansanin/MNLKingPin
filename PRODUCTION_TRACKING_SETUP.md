# Production Tracking Setup

## Storage and Deployment

The deployed site runs on Netlify. Its orders already live in Netlify Blobs (`kingpin-orders` and `kingpin-order-index`), so this feature extends each order record instead of introducing MySQL or a second order database. Production stage, ETA, remarks, design approval, notifications, and timestamped history are stored with that shared order. Final designs and payment media remain in the existing `kingpin-order-designs` store.

Netlify does not execute the repository's PHP files. The deployed production path uses Netlify Functions and server-side environment variables; `api/orders.php` and PHPMailer are not the production backend.

## Required Netlify Variables

Set these in Netlify **Site configuration → Environment variables** for every deploy context used:

- `KINGPIN_AUTH_SECRET`: a random secret of at least 32 characters. Keep it private and stable; changing it signs out all current sessions.
- `KINGPIN_ADMIN_USERNAME`: the initial admin username.
- `KINGPIN_ADMIN_PASSWORD`: the initial admin password, at least 8 characters. Do not use the old browser default credentials.
- Configure one email provider for account verification and production updates:
  - `SMTP_USER` and `SMTP_PASS`, with optional `SMTP_FROM`; or
  - `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.
- `GOOGLE_CLIENT_ID` is optional if the deployed Google sign-in client ID is the one already in the page.

To generate `KINGPIN_AUTH_SECRET` without sending it through chat, run this locally and paste the output directly into Netlify:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

After saving the variables, trigger a new Netlify deploy so the Functions receive them. Confirm `/.netlify/functions/auth` registration/login requests no longer return HTTP 503. Set the admin username/password as well; without them the admin login correctly stays unavailable until an initial admin is configured.

No secret belongs in `index.html`, `js/app.js`, or a committed `.env` file. Account creation requires a working verification email provider. If authentication variables are absent, the functions fail closed and logins/order reads will not work.

The first successful environment-backed admin login bootstraps the admin. Admin credential changes are then stored as a scrypt password hash in the `kingpin-auth` Blob store.

If the admin later forgets the password, update `KINGPIN_ADMIN_USERNAME`/`KINGPIN_ADMIN_PASSWORD` in Netlify and redeploy. The environment credentials are a server-only recovery path: a successful recovery login replaces the stored admin hash with the configured password hash. Keep those Netlify values private and available to the site owner.

## Existing Data and Accounts

- Existing Netlify order stores and legacy order arrays are read and indexed without deleting the original records. Legacy statuses are mapped into production stages when first read.
- Orders that exist only in an admin browser's `kingpinOrders` localStorage are migrated to shared Blobs after that admin signs in. The migration action creates missing records only and does not overwrite an existing shared order.
- Customer profiles/passwords created by the old browser-only login were local to one browser and stored without server authentication. They cannot be safely migrated as trusted credentials. Each existing customer must create/verify an account using the same email address; that email continues to match their existing orders.
- On page initialization, existing local customer profile records are retained but legacy plaintext password fields are removed. Customer passwords are now verified only against server-side password hashes.
- The PHP/XAMPP endpoints are not a synchronized Netlify database. Use Netlify Functions (for example, `netlify dev`) to exercise authenticated workflows locally.

## Workflow

1. Admin verifies payment after reviewing a GCash proof, or verifies the selected payment method.
2. Admin uploads the final design and advances to Design Approval.
3. The customer approves it or submits a revision note from My Orders.
4. The server rejects Printing / Production until approval is recorded, then enforces the remaining stage order. On Hold and Cancelled are exception states.
5. Stage changes save history, ETA/remarks, an in-app event, and a best-effort email. Email failure does not undo a saved order update.

The existing `status` field remains synchronized for receipts and purchase history. New tracking fields are additive; there is no SQL migration.

## Tests

Run `npm test` for team-order compatibility, legacy attachment migration, authentication/authorization, production stage rules, approval gates, cross-customer isolation, notification failure handling, and protected design media.

Manual smoke test after Netlify variables are set:

1. Sign in as admin and create an order from a customer account.
2. Upload GCash proof if applicable and verify payment as admin.
3. Upload a final design, advance to Design Approval, and confirm Printing is rejected before customer approval.
4. Sign in to the same customer account in a second browser, approve the design, and confirm the timeline/history updates.
5. Move the order through Printing, Quality Checking, Ready, and Completed; confirm Purchase History and customer notifications.
6. Sign in as another customer and confirm the first customer's orders and design files are not returned.