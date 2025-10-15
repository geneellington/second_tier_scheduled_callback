# Second Tier Scheduled Callback — UI + Deploy

This repo hosts the static UI (served from S3 via CloudFront) and a GitHub Action that deploys changes automatically.

## Overview

- **Hosting**
  - **S3 bucket**: `gene-scheduled-callback`
  - **Prefix**: `scheduled-callback-ui/`
  - **CloudFront**: distribution `d2l0blcwz7cz3m`
  - Origin path: `/scheduled-callback-ui`
  - Default root object: `index.html`

- **UI entry point**: `index.html` (calendar view with left-hand hour labels)
- **Capacity config**: `capacity.json` (per-group, per-10-minute slot capacities)
- **Backend API (prod)**: `https://f36ru2h4ua.execute-api.us-east-1.amazonaws.com/prod`

## Files

- `index.html` — Calendar UI with:
  - Day picker + Today/Next 4 tabs
  - Group selector (from `capacity.json`)
  - Time zone selector (sticky)
  - Slots (10-min) with used/capacity, double-click to prefill form
  - Create form (local TZ → UTC conversion) sending `{ date, time, groupKey, … }`
  - Entries table (times shown in selected TZ)
- `capacity.json` — Production config fetched by the UI.
- `legacy_calendar_poc.html` — Old large POC page (archived).
- `.github/workflows/deploy.yml` — S3 sync + CloudFront invalidation.

## Capacity.json format

```json
{
  "version": 2,
  "groups": {
    "groupKey": {
      "displayName": "Shown in dropdown",
      "queue": {
        "name": "Amazon Connect Queue Name",
        "arn": "Amazon Connect Queue ARN"
      },
      "slots": {
        "HH:MM": 0 | 1 | 2 | ...  // capacities; missing keys are treated as 0
      }
    }
  }
}
