# Timeslot App — TODO

_Last updated: Oct 21, 2025_

## New items (from your notes)
- [ ] **Externalize API Base URL for non-admin users.** Some users won't see Settings, so `apiBase` must come from a config source (not user input).
- [ ] **Quick Day Selector (7-day strip).** Add buttons for Today + next 6 days in the top toolbar.
- [ ] **Cognito authentication & RBAC.** Authenticate users and gate access to Screens (Configuration, Timeslots, Reporting) by role/permissions.

---

## Near‑term (before customer pilot)
- [ ] **Confirm Amazon Connect tasks fire** on create (StartTaskContact).  
  - Set `CONFIRM_DELAY_MINUTES=0` to see immediate tasks.  
  - Verify in Connect **Contact search** (Channel=Task) and CloudWatch logs.
- [x] **Timeslot grid “×” deletes via API** (data-id/iso set; capture-phase handler). *(Done)*
- [ ] **UI polish:** dropdown contrast, chip width, gear button hitbox & collapse panel. *(Review current build)*

---

## A. Externalize API Base URL (high priority)
**Goal:** App loads `apiBase` automatically for users without Settings access.

**Approach options (pick one):**
- **A1 — Static config file:** host a `config.app.json` next to `index.html` (same origin). App loads it on boot and uses `apiBase` (and any future flags).
- **A2 — Environment build:** embed `apiBase` at build time (e.g., `APP_API_BASE` env → baked into `app.js`). Requires separate builds per env.
- **A3 — Cognito + claims:** read `apiBase`/tenant from ID token claims (after auth). Server trusts token; UI avoids a settings screen for regular users.

**Tasks:**
- [ ] Implement loader: `GET ./config.app.json` → merge into Settings at startup if present.
- [ ] Hide/lock Settings for non-admin role.
- [ ] Document where to place `config.app.json` in each environment (local, dev, prod).

**Acceptance:**
- [ ] Admins can still override in Settings.  
- [ ] Non-admins never need to type a URL; app works out-of-the-box.  
- [ ] If the file is missing, app shows a clear error.

---

## B. Quick Day Selector (7‑day strip)
**Goal:** Faster day navigation without opening the date picker.

**Spec:**
- Today + next 6 days as small buttons (e.g., `Tue 21`, `Wed 22`, …).  
- Keyboard support: ←/→ cycle; `T` jumps to Today.  
- Keeps queue & tz selections; reloads entries via `loadFromApi(date)`.

**Tasks:**
- [ ] Render buttons on boot based on `currentTz()` (not system).  
- [ ] Wire click → set date, save settings, `updateDateTags()`, `buildSlots()`, `renderEntries()`, `loadFromApi(date)` (if API enabled).  
- [ ] Style “Today” as primary; selected date highlighted.

**Acceptance:**
- [ ] One click switches the grid and Entries table to the chosen date.  
- [ ] Works across month/year boundaries & DST transitions.

---

## C. Cognito Authentication & RBAC
**Goal:** Restrict access and actions by user role.

**Plan:**
- **C1: User Pool & App Client** (Hosted UI optional).  
- **C2: Frontend auth flow** → acquire ID token (JWT); store securely.  
- **C3: API Gateway Authorizer** (Cognito).  
- **C4: Backend derives actor from token**: `event.requestContext.authorizer.claims["cognito:username"]` (or preferred claim).  
- **C5: UI → send token on requests** (Authorization header) or omit and let gateway auth handle.  
- **C6: Roles/Groups**: `admin`, `agent`. Admins see Config & Reports and can edit others’ entries; agents can only edit/delete their own.

**Tasks:**
- [ ] Add auth guard to routes/panels (hide Settings/Reports for non-admin).  
- [ ] API checks ownership on PATCH/DELETE (unless admin).  
- [ ] Map token → `operator` for audit (server-side) and UI personalization.

**Acceptance:**
- [ ] Unauthenticated users cannot access.  
- [ ] Agent cannot delete another agent’s entry; admin can.  
- [ ] Audit rows show `actor` = Cognito username.

---

## D. Audit / History via DynamoDB Streams (Option A)
**Status:** Design approved.

**Tasks:**
- [ ] Create `timeslot_audit` table (PK=`PK`, SK=`SK`).  
- [ ] (Optional) GSIs for reporting: by date/time (G1), by phone (G2), by agent (G3).  
- [ ] Enable Streams (NEW_AND_OLD_IMAGES) on `geneTimeSlotTable`.  
- [ ] Deploy `geneTimeslotAudit` Lambda (subscriber) to write audit rows.  
- [ ] API stamps `createdBy`/`lastActor` & `lastAction` on POST/PATCH/DELETE.  
- [ ] DELETE uses TransactWrite: update `lastActor/lastAction`, then delete (so stream carries actor).  
- [ ] Validate with create/update/delete → inspect audit rows.

**Acceptance:**
- [ ] Each change creates an audit record with `actor`, `when`, `action`, snapshots.  
- [ ] Queries by date/phone/agent return expected history.

---

## E. Reporting (phase after audit)
- [ ] Simple report page: date range, queue, agent filters; show totals per slot, per agent, and by outcome (kept for later).  
- [ ] Serverless option: query via Lambda on GSIs; cache with CloudFront if needed.

---

## F. Observability & Ops
- [ ] CloudWatch dashboards for Lambda errors, API 4xx/5xx.  
- [ ] Structured logs (request id, actor, entry id).  
- [ ] Alarms on error spikes.  
- [ ] Backup/retention decisions for audit table (TTL optional).

---

## G. Testing checklist
- [ ] CORS happy path: POST/PATCH/DELETE pass preflight from all allowed origins.  
- [ ] Time zone shifts reflect in slot rendering & API payloads.  
- [ ] Grid “×” and Entries “×” each send a **single** DELETE.  
- [ ] Phone normalization (E.164) preserved through UI → API → DB.  
- [ ] Cognito: login/logout, role-based UI, 403 on forbidden actions.
