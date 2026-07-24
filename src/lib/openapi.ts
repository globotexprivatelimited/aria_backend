export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Aria API",
    version: "1.0.0",
    description:
      "Multi-tenant AI concierge for hotels. Guests message over WhatsApp; staff run the hotel from the console.\n\n" +
      "**To test protected endpoints:** click Authorize (top right) and enter the admin key, then use Try it out on any endpoint.\n\n" +
      "Demo values are pre-filled: hotel `demo`, webhook token `demo-token-123`, staff number `+919000000001`.",
  },
  servers: [{ url: "http://localhost:4000", description: "Local development" }],
  tags: [
    { name: "Health", description: "Service and database status" },
    { name: "Guest messages", description: "Inbound WhatsApp from guests" },
    { name: "Staff commands", description: "Inbound WhatsApp from hotel staff" },
    { name: "Front desk", description: "Check guests in and out" },
    { name: "Dashboard", description: "Read-only views for the manager" },
    { name: "Privacy", description: "Data protection rights (DPDP Act)" },
  ],
  components: {
    securitySchemes: {
      adminKey: {
        type: "apiKey",
        in: "header",
        name: "x-admin-key",
        description: "Shared secret for staff endpoints. Local value: dev-admin-key",
      },
    },
    parameters: {
      hotelId: {
        name: "hotelId",
        in: "query",
        required: false,
        schema: { type: "string", default: "demo" },
        description: "Which hotel to read. Defaults to demo.",
      },
    },
    schemas: {
      WatiInbound: {
        type: "object",
        required: ["waId", "text", "id"],
        properties: {
          waId: { type: "string", example: "+919222000001", description: "Guest WhatsApp number" },
          text: { type: "string", example: "Hello", description: "Message body" },
          type: { type: "string", example: "text" },
          id: { type: "string", example: "swagger-1", description: "Unique message id. Reusing an id is ignored as a duplicate." },
          senderName: { type: "string", example: "Test Guest" },
        },
      },
      Ack: {
        type: "object",
        properties: { ok: { type: "boolean", example: true } },
        description: "Always returns 200 so Wati does not retry. The outcome appears in the server logs.",
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" }, message: { type: "string" } },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Is the service running",
        responses: {
          "200": {
            description: "Service is up",
            content: {
              "application/json": {
                example: { ok: true, service: "aria-api", time: "2026-07-23T05:00:00.000Z" },
              },
            },
          },
        },
      },
    },
    "/ready": {
      get: {
        tags: ["Health"],
        summary: "Is the service ready to take traffic",
        description: "Checks the database connection and reports in-flight work. Returns 503 while shutting down.",
        responses: {
          "200": {
            description: "Ready",
            content: {
              "application/json": {
                example: { ready: true, db: true, inFlightJobs: 0, queues: 0 },
              },
            },
          },
          "503": { description: "Not ready - database unreachable or shutting down" },
        },
      },
    },

    "/webhooks/wati/{hotelToken}": {
      post: {
        tags: ["Guest messages"],
        summary: "A guest sends a WhatsApp message",
        description:
          "The entry point for every guest message.\n\n" +
          "Runs: hotel lookup by token, duplicate check, message logging, consent, STOP handling, safety checks, then session verification.\n\n" +
          "**Try these messages:**\n" +
          "- `Hello` - first contact, gets the consent notice and a room request\n" +
          "- `Help I have chest pain` - emergency, replies with 112 and alerts staff\n" +
          "- `who is staying in room 305?` - blocked, protects other guests\n" +
          "- `507` then a name - completes room verification\n" +
          "- `STOP` - erases all their data\n\n" +
          "Watch the server window for the result.",
        parameters: [
          {
            name: "hotelToken",
            in: "path",
            required: true,
            schema: { type: "string", default: "demo-token-123" },
            description: "The hotel's secret webhook token. This both authenticates and identifies the hotel.",
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/WatiInbound" } } },
        },
        responses: {
          "200": {
            description: "Acknowledged",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ack" } } },
          },
        },
      },
    },

    "/webhooks/admin/{hotelToken}": {
      post: {
        tags: ["Staff commands"],
        summary: "A staff member sends a command",
        description:
          "Only numbers registered as staff for this hotel are accepted.\n\n" +
          "**Commands:**\n" +
          "- `HELP` - list commands\n" +
          "- `EMERGENCY MODE ON` / `OFF` - switch the whole hotel to a crisis notice\n" +
          "- `CHECKIN <room> <phone> <name>` - register a guest\n" +
          "- `CHECKOUT <room-or-phone>` - close a stay\n\n" +
          "Seeded staff number for testing: `+919000000001`",
        parameters: [
          {
            name: "hotelToken",
            in: "path",
            required: true,
            schema: { type: "string", default: "demo-token-123" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WatiInbound" },
              example: { waId: "+919000000001", text: "HELP", type: "text", id: "swagger-admin-1" },
            },
          },
        },
        responses: {
          "200": {
            description: "Acknowledged",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ack" } } },
          },
        },
      },
    },

    "/api/checkin": {
      post: {
        tags: ["Front desk"],
        summary: "Register a guest at the front desk",
        description:
          "Creates a verified session. This is the strongest form of room verification: it marks the guest " +
          "front_desk_match, and any other phone claiming that room is refused.",
        security: [{ adminKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["hotelId", "room", "name", "phone"],
                properties: {
                  hotelId: { type: "string", example: "demo" },
                  room: { type: "string", example: "601" },
                  name: { type: "string", example: "Arjun Mehta" },
                  phone: { type: "string", example: "+919222000005" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Guest registered",
            content: {
              "application/json": {
                example: { ok: true, sessionId: "uuid", state: "active", room: "601", verified: true },
              },
            },
          },
          "400": { description: "Missing fields" },
          "401": { description: "Missing or wrong admin key" },
          "404": { description: "Hotel not found" },
        },
      },
    },

    "/api/checkout": {
      post: {
        tags: ["Front desk"],
        summary: "Close a guest stay",
        security: [{ adminKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["hotelId"],
                properties: {
                  hotelId: { type: "string", example: "demo" },
                  room: { type: "string", example: "601" },
                  phone: { type: "string", example: "+919222000005" },
                },
                description: "Give either a room or a phone.",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Result",
            content: { "application/json": { example: { ok: true, closed: true } } },
          },
          "400": { description: "Need hotelId and either room or phone" },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },

    "/api/dashboard/overview": {
      get: {
        tags: ["Dashboard"],
        summary: "Headline numbers for the manager",
        security: [{ adminKey: [] }],
        parameters: [{ $ref: "#/components/parameters/hotelId" }],
        responses: {
          "200": {
            description: "Counts",
            content: {
              "application/json": {
                example: {
                  hotelId: "demo",
                  guests: { active: 2, prospects: 1, flagged: 0 },
                  requests: { open: 0, today: 0 },
                  openByDepartment: [],
                  messagesToday: 9,
                  diningPendingConfirmation: 0,
                },
              },
            },
          },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },

    "/api/dashboard/guests": {
      get: {
        tags: ["Dashboard"],
        summary: "Guests currently in house",
        description: "Shows each guest's room, name, and how their room was verified.",
        security: [{ adminKey: [] }],
        parameters: [{ $ref: "#/components/parameters/hotelId" }],
        responses: {
          "200": {
            description: "Guest list",
            content: {
              "application/json": {
                example: {
                  count: 1,
                  guests: [
                    {
                      sessionId: "uuid",
                      phone: "+919888800001",
                      room: "305",
                      name: "Ravi Kumar",
                      state: "active",
                      verified: true,
                      verificationMethod: "front_desk_match",
                    },
                  ],
                },
              },
            },
          },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },

    "/api/dashboard/requests": {
      get: {
        tags: ["Dashboard"],
        summary: "The request queue",
        description: "Returns an empty list until the AI brain is connected and starts creating requests.",
        security: [{ adminKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/hotelId" },
          { name: "status", in: "query", schema: { type: "string", enum: ["received", "in_progress", "resolved"] } },
          { name: "priority", in: "query", schema: { type: "string", enum: ["normal", "urgent", "human_required", "emergency"] } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: {
          "200": { description: "Requests", content: { "application/json": { example: { count: 0, requests: [] } } } },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },

    "/api/dashboard/alerts": {
      get: {
        tags: ["Dashboard"],
        summary: "Things needing a human eye",
        description: "Unverified guests, sessions gone quiet, urgent requests, and whether emergency mode is on.",
        security: [{ adminKey: [] }],
        parameters: [{ $ref: "#/components/parameters/hotelId" }],
        responses: {
          "200": {
            description: "Alerts",
            content: {
              "application/json": {
                example: {
                  emergencyMode: false,
                  flaggedSessions: [],
                  unverifiedActiveGuests: [{ phone: "+919999000002", room: "412", name: "Mahasin Khan" }],
                  urgentRequests: [],
                },
              },
            },
          },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },

    "/api/dashboard/revenue": {
      get: {
        tags: ["Dashboard"],
        summary: "Dining and activity bookings",
        description: "Returns empty until the AI brain is connected.",
        security: [{ adminKey: [] }],
        parameters: [{ $ref: "#/components/parameters/hotelId" }],
        responses: {
          "200": { description: "Bookings over the last 30 days" },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },

    "/api/dashboard/conversations/{phone}": {
      get: {
        tags: ["Dashboard"],
        summary: "Full message history for one guest",
        description:
          "Every message kept verbatim. This is the dispute record: if a guest says they never asked for something, this is the proof.",
        security: [{ adminKey: [] }],
        parameters: [
          {
            name: "phone",
            in: "path",
            required: true,
            schema: { type: "string", default: "+919888800001" },
            description: "Guest WhatsApp number including the country code.",
          },
          { $ref: "#/components/parameters/hotelId" },
        ],
        responses: {
          "200": {
            description: "Thread",
            content: {
              "application/json": {
                example: {
                  phone: "+919888800001",
                  session: { state: "active", room: "305", name: "Ravi Kumar", verified: true },
                  messageCount: 2,
                  messages: [{ at: "2026-07-23T05:00:00.000Z", direction: "inbound", type: "text", body: "Hello" }],
                },
              },
            },
          },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },

    "/api/privacy/notice": {
      get: {
        tags: ["Privacy"],
        summary: "The privacy notice shown to guests",
        description: "Public. This is the wording a guest receives on first contact.",
        responses: {
          "200": {
            description: "Notice text",
            content: { "application/json": { example: { version: "v1", notice: "We use your messages to handle your requests..." } } },
          },
        },
      },
    },

    "/api/privacy/consent": {
      get: {
        tags: ["Privacy"],
        summary: "Check a guest's consent status",
        security: [{ adminKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/hotelId" },
          { name: "phone", in: "query", required: true, schema: { type: "string", default: "+919888800001" } },
        ],
        responses: {
          "200": { description: "Consent record" },
          "400": { description: "Phone required" },
          "401": { description: "Missing or wrong admin key" },
        },
      },
      post: {
        tags: ["Privacy"],
        summary: "Record or withdraw consent",
        security: [{ adminKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["hotelId", "phone", "granted"],
                properties: {
                  hotelId: { type: "string", example: "demo" },
                  phone: { type: "string", example: "+919888800001" },
                  granted: { type: "boolean", example: true },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Consent updated" },
          "400": { description: "Missing fields" },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },

    "/api/privacy/export": {
      get: {
        tags: ["Privacy"],
        summary: "Right of access - everything held about a guest",
        description: "Returns their consent record, sessions, full message history and requests.",
        security: [{ adminKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/hotelId" },
          { name: "phone", in: "query", required: true, schema: { type: "string", default: "+919888800001" } },
        ],
        responses: {
          "200": { description: "The guest's data" },
          "400": { description: "Phone required" },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },

    "/api/privacy/erase": {
      post: {
        tags: ["Privacy"],
        summary: "Right of erasure - delete a guest's personal data",
        description:
          "Deletes their messages, anonymises their sessions and requests, and withdraws consent. " +
          "The erasure itself is logged for audit. This cannot be undone.",
        security: [{ adminKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["hotelId", "phone"],
                properties: {
                  hotelId: { type: "string", example: "demo" },
                  phone: { type: "string", example: "+919222000003" },
                  requestedBy: { type: "string", example: "console" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Erased",
            content: { "application/json": { example: { ok: true, erasureId: "uuid", recordsWiped: 3 } } },
          },
          "400": { description: "Missing fields" },
          "401": { description: "Missing or wrong admin key" },
        },
      },
    },
  },
} as const;
