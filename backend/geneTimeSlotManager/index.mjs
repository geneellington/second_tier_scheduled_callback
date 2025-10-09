// ===== CORS helpers (ESM/.mjs) =====
const ALLOW_ORIGINS = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function makeCorsHeaders(event) {
  const origin = (event?.headers?.origin || event?.headers?.Origin || "").trim();
  const allowOrigin = ALLOW_ORIGINS.includes(origin) ? origin : "";
  const base = {
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key",
  };
  return allowOrigin ? { ...base, "Access-Control-Allow-Origin": allowOrigin } : base;
}

function respond(event, statusCode, bodyObj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...makeCorsHeaders(event) },
    body: bodyObj != null ? JSON.stringify(bodyObj) : "",
  };
}

// Utility to read method across REST API and HTTP API
function getMethod(event) {
  return event?.requestContext?.http?.method || event?.httpMethod || "";
}

import { ConnectClient, StartTaskContactCommand } from "@aws-sdk/client-connect";
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID;
const CONTACT_FLOW_ARN_CONFIRMATION = process.env.CONTACT_FLOW_ARN_CONFIRMATION;
const connect = new ConnectClient({});

// index.mjs — Node.js 18+/20+/22 (ESM) — DynamoDB v3 client
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  TransactWriteItemsCommand
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";

// ---------- Config ----------
const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME || "geneTimeSlotTable";

// CORS — SINGLE DEFINITION (do not duplicate)
const ORIGIN = process.env.CORS_ORIGIN || "*";
//const CORS_HEADERS = {
//  "Access-Control-Allow-Origin": ORIGIN,
//  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
//  "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key"
//};
// replace your old helper with this
const res = (event, statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...makeCorsHeaders(event), ...extraHeaders },
  body: body == null ? "" : JSON.stringify(body),
});


// ===== Notification timing =====
// Backward-compat: NOTIFY_AHEAD_MINUTES (existing) still works.
// New explicit knobs you can set in Lambda env vars:
//   - CONFIRM_DELAY_MINUTES  (default 0 = send confirmation immediately)
//   - REMINDER_AHEAD_MINUTES (default = NOTIFY_AHEAD_MINUTES or 15 if none)
const AHEAD_MIN = Number(process.env.NOTIFY_AHEAD_MINUTES ?? 15);
const CONFIRM_DELAY_MINUTES  = parseInt(process.env.CONFIRM_DELAY_MINUTES  ?? '0', 10);
const REMINDER_AHEAD_MINUTES = parseInt(process.env.REMINDER_AHEAD_MINUTES ?? String(AHEAD_MIN), 10);


// Fields we manage; everything else (e.g., phone) passes through
const RESERVED = new Set([
  "PK","SK","id","date","time","durationMin","agentId","customer",
  "notes","capacityKey","createdAt","updatedAt",
  "scheduledAt","scheduledDate",
  "confirmationAt","reminderAt",
  "notifyAt","notifyDate",
  "currentDate","currentTime"
]);


// Helpers
const toISOZ = (date, time) => `${date}T${time}:00Z`;
const stripKeys = (item = {}) => {
  const { PK, SK, notifyDate, ...rest } = item; // keep notifyAt/scheduledAt; hide PK/SK/notifyDate
  return rest;
};
function buildUpdateExpression(obj) {
  const names = {};
  const rawValues = {};
  const sets = [];
  let i = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const nk = `#k${i}`;
    const nv = `:v${i}`;
    names[nk] = k;
    rawValues[nv] = v;
    sets.push(`${nk} = ${nv}`);
    i++;
  }
  if (!sets.length) {
    // ensure we at least bump updatedAt
    names["#u"] = "updatedAt";
    rawValues[":u"] = new Date().toISOString();
    return {
      UpdateExpression: "SET #u = :u",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(rawValues, { removeUndefinedValues: true })
    };
  }
  return {
    UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(rawValues, { removeUndefinedValues: true })
  };
}

console.log(JSON.stringify({
  msg: "Timing config",
  CONFIRM_DELAY_MINUTES,
  REMINDER_AHEAD_MINUTES,
  NOTIFY_AHEAD_MINUTES: AHEAD_MIN
}));


// ---------- Handler ----------
export const handler = async (event) => {

// ---- CORS preflight (must be the first lines inside the handler) ----
  const method =
    (event?.requestContext?.http?.method) || // HTTP API shape
    event?.httpMethod ||                      // REST API shape
    "";

  if (method === "OPTIONS") {
    // Respond to the browser's CORS preflight quickly, with headers only
    return {
      statusCode: 204,                  // No Content
      headers: makeCorsHeaders(event),  // <-- this adds Access-Control-Allow-*
      body: "",
    };
  }
// --------------------------------------------------------------------



  try {
    const method   = event.httpMethod || event.requestContext?.http?.method || "GET";
    const resource = event.resource; // "/entries" or "/entries/{id}"
    const idParam  = event.pathParameters?.id || null;
    const qs       = event.queryStringParameters || {};
    const body     = event.body ? JSON.parse(event.body) : null;

    // OPTIONS preflight (if routed to Lambda)
    if (method === "OPTIONS") {
      return {
        statusCode: 204,
        headers: makeCorsHeaders(event),
        body: "",
      };
    }

    // GET /entries?date=YYYY-MM-DD
    if (resource === "/entries" && method === "GET") {
      const date = qs.date;
      if (!date) return res(event, 400, { message: "Missing required query param: date" });

      const out = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: marshall({ ":pk": `DATE#${date}`, ":p": "TIME#" })
      }));

      const items = (out.Items || []).map(i => stripKeys(unmarshall(i)));
      return res(event, 200, items);
    }

    // POST /entries (create; pass-through extras like phone)
    if (resource === "/entries" && method === "POST") {
      if (!body || !body.date || !body.time) {
        return res(event, 400, { message: "Missing required fields: date, time" });
      }

      const id  = typeof randomUUID === "function"
        ? randomUUID()
        : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      const now = new Date().toISOString();

      // --- compute timestamps for Confirmation / Reminder / Notification ---
      const scheduledAt     = toISOZ(body.date, body.time); // exact callback moment (UTC)
      const confirmationAt  = new Date(Date.parse(scheduledAt) + CONFIRM_DELAY_MINUTES*60_000).toISOString(); // after create
      const reminderAt      = new Date(Date.parse(scheduledAt) - REMINDER_AHEAD_MINUTES*60_000).toISOString(); // before start
      // Backward-compat field names you already use:
      const notifyAt        = new Date(Date.parse(scheduledAt) - AHEAD_MIN*60_000).toISOString(); // keep writing this too
      const scheduledDate   = scheduledAt.slice(0,10);
      const notifyDate      = scheduledDate;

      const item = {
        PK: `DATE#${body.date}`,
        SK: `TIME#${body.time}#ID#${id}`,
        id,
        date: body.date,
        time: body.time,
        durationMin: Number(body.durationMin ?? 10),
        agentId: body.agentId ?? "",
        customer: body.customer ?? "",
        notes: body.notes ?? "",
        capacityKey: body.capacityKey ?? "default",
        createdAt: now,
        updatedAt: now,
        // store the four fields used by the schedule Lambda
        scheduledAt,
        scheduledDate,
        confirmationAt,
        reminderAt,
        notifyAt,
        notifyDate
      };

      // pass-through any extra fields (e.g., phone)
      for (const [k, v] of Object.entries(body)) {
        if (!RESERVED.has(k)) item[k] = v;
      }

      await ddb.send(new PutItemCommand({
        TableName: TABLE,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      }));

      try {
        const attrs = {
          entryId: item.id,
          date: item.date,
          time: item.time,
          customer: item.customer ?? "",
          phone: item.phone ?? "",
          agentId: item.agentId ?? "",
          capacityKey: item.capacityKey ?? "default"
        };
        const cmd = new StartTaskContactCommand({
          InstanceId: CONNECT_INSTANCE_ID,
          ContactFlowId: CONTACT_FLOW_ARN_CONFIRMATION,
          Name: `Callback Confirmation ${item.date} ${item.time}`,
          Description: "Notify customer the callback has been scheduled.",
          Attributes: attrs   // available in the contact flow as $.Attributes.*
        });
        const out = await connect.send(cmd);
        console.log("StartTaskContact OK (Confirmation)", { id: item.id, contactId: out.ContactId });
        // OPTIONAL: mark it in the record (uncomment if you want a flag)
        // await ddb.send(new UpdateCommand({
        //   TableName: TABLE_NAME,
        //   Key: { PK: item.PK, SK: item.SK },
        //   UpdateExpression: "SET confirmationTaskSentAt = :ts",
        //   ExpressionAttributeValues: { ":ts": new Date().toISOString() }
        // }));
      } catch (e) {
        console.error("StartTaskContact FAILED (Confirmation)", { id: item.id, err: e });
      }

      return res(event, 201, stripKeys(item));
    }


    // PATCH /entries/{id} (update and/or move)
    if (resource === "/entries/{id}" && method === "PATCH") {
      const id = idParam;
      if (!id)  return res(event, 400, { message: "Missing path param: id" });
      if (!body) return res(event, 400, { message: "Missing body" });

      const { currentDate, currentTime } = body;
      if (!currentDate || !currentTime) {
        return res(event, 400, { message: "Missing required fields: currentDate, currentTime" });
      }

      const oldPK = `DATE#${currentDate}`;
      const oldSK = `TIME#${currentTime}#ID#${id}`;
      const now   = new Date().toISOString();

      const targetDate = body.date ?? currentDate;
      const targetTime = body.time ?? currentTime;
      const moving     = (targetDate !== currentDate) || (targetTime !== currentTime);

      // dynamic fields to set (ignores the control fields)
      const toSet = { updatedAt: now };
      for (const [k, v] of Object.entries(body)) {
        if (k === "date" || k === "time") continue;              // handled if moving
        if (k === "currentDate" || k === "currentTime") continue;
        if (v === undefined) continue;
        toSet[k] = v;
      }

      // ----- NOT MOVING: in-place update -----
      if (!moving) {
        const upd = buildUpdateExpression(toSet);
        await ddb.send(new UpdateItemCommand({
          TableName: TABLE,
          Key: marshall({ PK: oldPK, SK: oldSK }),
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
          ...upd
        }));
        const got = await ddb.send(new GetItemCommand({
          TableName: TABLE,
          Key: marshall({ PK: oldPK, SK: oldSK })
        }));
        return res(event, 200, stripKeys(unmarshall(got.Item)));
      }

      // ===== MOVING: date/time changed =====
      const got = await ddb.send(new GetItemCommand({
        TableName: TABLE,
        Key: marshall({ PK: oldPK, SK: oldSK })
      }));
      if (!got.Item) return res(404, { message: "Entry not found" });

      const oldItem = unmarshall(got.Item);

      // destination key
      const newPK = `DATE#${targetDate}`;
      const newSK = `TIME#${targetTime}#ID#${id}`;

      // --- compute timestamps for the NEW time ---
      const scheduledAt     = toISOZ(targetDate, targetTime);
      const confirmationAt  = new Date(Date.parse(scheduledAt) + CONFIRM_DELAY_MINUTES*60_000).toISOString();
      const reminderAt      = new Date(Date.parse(scheduledAt) - REMINDER_AHEAD_MINUTES*60_000).toISOString();
      // Backward-compat:
      const notifyAt        = new Date(Date.parse(scheduledAt) - AHEAD_MIN*60_000).toISOString();
      const scheduledDate   = scheduledAt.slice(0,10);
      const notifyDate      = scheduledDate;


      const newItem = {
        ...oldItem,
        PK: newPK,
        SK: newSK,
        date: targetDate,
        time: targetTime,
        updatedAt: now,
        scheduledAt,
        scheduledDate,
        confirmationAt,   // <-- add
        reminderAt,       // <-- add
        notifyAt,
        notifyDate
      };
      // apply any additional fields from the PATCH body
      for (const [k, v] of Object.entries(toSet)) newItem[k] = v;

      await ddb.send(new TransactWriteItemsCommand({
        TransactItems: [
          {
            Delete: {
              TableName: TABLE,
              Key: marshall({ PK: oldPK, SK: oldSK }),
              ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
            }
          },
          {
            Put: {
              TableName: TABLE,
              Item: marshall(newItem, { removeUndefinedValues: true }),
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
            }
          }
        ]
      }));

      return res(event, 200, stripKeys(newItem));
    }


    // DELETE /entries/{id}?date=...&time=...
    if (resource === "/entries/{id}" && method === "DELETE") {
      const id = idParam;
      const { date, time } = qs;
      if (!id || !date || !time) return res(event, 400, { message: "Missing id, date, or time" });

      await ddb.send(new DeleteItemCommand({
        TableName: TABLE,
        Key: marshall({ PK: `DATE#${date}`, SK: `TIME#${time}#ID#${id}` })
      }));

      return res(event, 200, { ok: true });
    }

    return res(404, { message: "Not found" });
  } catch (err) {
    console.error(err);
    return res(500, { message: "Internal server error", error: String(err?.message || err) });
  }
};
