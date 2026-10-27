# Hobby Projects

All my hobby projects in one repository. Each project lives in its own folder under `projects/` and deploys as its own Vercel project.

| Project | Folder | What it is | Status |
|---------|--------|------------|--------|
| File Portal | [`projects/file-portal`](projects/file-portal) | Password-protected uploads (up to 100 MB), public file list and downloads, stored in Vercel Blob. | Live on Vercel |
| AI Friend *(name TBD)* | [`projects/ai-friend`](projects/ai-friend) | A cute realtime voice buddy (OpenAI Realtime) with memory and web search, headed for an ESP32 robot. Needs an always-on host, not Vercel. | Server + browser test page built |

## Deploying a project on Vercel

Each project is a separate Vercel project that points at its own folder:

1. In Vercel, click *Add New… → Project* and import this repository.
2. Set **Root Directory** to the project's folder, for example `projects/file-portal`.
3. Add that project's environment variables (see its README) and deploy.

Changing one project's folder shouldn't affect the others. If Vercel rebuilds every project on each push, turn on the option to skip deployments when nothing changed in the root directory. It's in the project's Git or build settings, though the exact name may differ.

## Adding a new project

Create `projects/<name>/` with its own `package.json` and README, add a row to the table above, and import it into Vercel with that folder as the Root Directory.
