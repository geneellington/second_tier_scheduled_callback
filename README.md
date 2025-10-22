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


The following describes the environment variables used by the scheduler Lambda (e.g. geneScheduleCallback)

* **MIN_AGE_MS** (e.g., `30000` = 30 seconds)
  “Don’t send anything until the record is at least this old.”
  Purpose: Avoid edge cases where an item is created and (due to rounding/clock skew) looks due immediately. With a 30-second minimum age, the scheduler won’t touch brand-new items for the first 30s.

* **WINDOW_BEFORE_MS** (e.g., `2000` = 2 seconds)
  “Allow being this tiny bit **early**.”
  Purpose: If the scheduler tick lands a hair *before* the exact due time, we still treat it as due. Two seconds is enough to cover tiny skews; keep this small.

* **WINDOW_AFTER_MS** (e.g., `90000` = 90 seconds)
  “Allow being this much **late**.”
  Purpose: The scheduler runs once a minute and there’s some processing/queueing delay. This late-tolerance makes sure we don’t miss an item if the tick arrives a little after the target minute.

# How the scheduler decides “due”

Think of a sliding window around “now”:

```
(now - WINDOW_AFTER_MS)  <=  targetTime  <=  (now + WINDOW_BEFORE_MS)
```

If the target time (reminderAt / notifyAt) falls inside that window **and** the item is older than `MIN_AGE_MS`, it fires.

# Defaults vs. your suggested values

Your code’s defaults (if you set nothing):

* `MIN_AGE_MS = 0` (no minimum age)
* `WINDOW_BEFORE_MS = 2000` (2s early allowed)
* `WINDOW_AFTER_MS = 60000` (60s late allowed)

Suggested robust settings while testing:

* `MIN_AGE_MS = 30000` (adds a 30s “cool-down” after create)
* `WINDOW_BEFORE_MS = 2000` (keep tiny)
* `WINDOW_AFTER_MS = 90000` (gives a bit more late tolerance than 60s)

# When to tweak

* Seeing things **fire immediately after create**?
  Increase `MIN_AGE_MS` (e.g., 30000 or 60000).

* Seeing a **rare miss** because a tick was slow?
  Increase `WINDOW_AFTER_MS` (e.g., from 60000 → 90000).

* Worried about firing **too early**?
  Keep `WINDOW_BEFORE_MS` very small (1000–2000ms).

# Important: these do **not** set offsets

They **don’t** control “how many minutes before the appointment” your reminder/notification happen. That’s done in the **API Lambda** with:

* `REMINDER_AHEAD_MINUTES` (e.g., 2 → two minutes before)
* `NOTIFY_AHEAD_MINUTES` (0 → at the scheduled time)

These scheduler knobs only provide **tolerance around the exact due moment** to handle real-world timing jitter.


