# File Portal

A small file sharing site, built to run on Vercel:

- **Anyone with the link** sees the list of uploaded files and can download them.
- **Uploading** needs a shared upload password. Files can be any type, up to 100 MB each. Files over 10 MB are uploaded in parts, so a dropped connection only retries the failed part.
- Files are stored in [Vercel Blob](https://vercel.com/docs/vercel-blob). The browser uploads them straight to Blob storage, so Vercel's function size limits don't apply.

## Deploy on Vercel

1. **Import the repo:** in Vercel, click *Add New… → Project* and pick this GitHub repository. Keep the default settings, because `vercel.json` already sets the build command and output folder.
2. **Add Blob storage:** in the project, open the *Storage* tab, create a **Blob** store and connect it to the project. If you're asked for an access type, choose **Public**, since the app makes files downloadable by link. Then check *Settings → Environment Variables* for `BLOB_READ_WRITE_TOKEN`. Some store connections don't add it, and uploads need it. If it's missing, copy the read-write token (it starts with `vercel_blob_rw_`) from the Blob store's page and add it yourself.
3. **Set the upload password:** under *Settings → Environment Variables*, add `UPLOAD_PASSWORD` with a long passphrase.
4. **Redeploy:** go to *Deployments*, open the latest one and choose *Redeploy*, so the new variables take effect.

Vercel's dashboard changes over time, so menu names may differ slightly from the above.

## How it works

| Path                  | What it does                                                                 |
|-----------------------|------------------------------------------------------------------------------|
| `public/`             | The page (`index.html`, `style.css`). `app.js` is built from `src/app.js`.   |
| `api/files.js`        | Lists every file in the Blob store under `files/`.                           |
| `api/upload.js`       | Checks the password, then issues a short-lived upload token with a 100 MB cap. |
| `api/check-password.js` | Lets the page report a wrong password before uploading.                    |
| `lib/config.js`       | The 100 MB limit and the password check.                                      |

Each upload is stored as `files/<timestamp>-<random>/<original file name>`. Download links point straight at Vercel Blob and are sent as downloads, not opened in the browser.

To change the limit, edit `MAX_FILE_MB` in `lib/config.js` (100 MB means 100 × 1024 × 1024 bytes).

## Removing a file

There is no admin page. Delete files in the Vercel dashboard: *Storage → your Blob store → Browser*.

## Costs and limits

Vercel Blob bills for storage and data transfer beyond the free allowance. On the Hobby plan there's no overage bill: Blob stops working until the monthly period resets. Vercel's docs list the Hobby allowance as roughly 1 GB of storage and 10 GB of Blob transfer per month (verify on the current pricing page), so with 100 MB files, delete old ones regularly. Check Vercel's current pricing, especially if the link is shared widely, because every download counts as transfer.

There is no rate limiting, virus scanning or automatic expiry. Anyone with the upload password can upload, so change the password if it leaks.

## Local development

```bash
npm install
npm run build
npx vercel dev     # needs the Vercel CLI and a linked project (vercel link, vercel env pull)
```
