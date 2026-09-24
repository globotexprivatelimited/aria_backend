alter table "Message" add column if not exists "deliveryStatus" text, add column if not exists "deliveryError" text, add column if not exists "statusAt" timestamp(3);
create index if not exists "Message_messageId_idx" on "Message" ("messageId");
