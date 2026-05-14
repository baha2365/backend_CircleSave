-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0001_init
-- Creates the full CircleSave base schema
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE "Role" AS ENUM ('MEMBER', 'ORGANIZER', 'ADMIN');

CREATE TYPE "CircleStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'DISSOLVED');

CREATE TYPE "MemberStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'ACTIVE',
  'DEFAULTED',
  'REMOVED'
);

CREATE TYPE "PaymentStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'PARTIAL',
  'REFUNDED'
);

CREATE TYPE "SwapStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TYPE "LedgerEntryType" AS ENUM (
  'CONTRIBUTION',
  'PAYOUT',
  'LATE_FEE',
  'PLATFORM_FEE',
  'REFUND',
  'ADJUSTMENT'
);

CREATE TYPE "DebitStatus" AS ENUM (
  'SCHEDULED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

-- ── User ──────────────────────────────────────────────────────────────────────

CREATE TABLE "User" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "email"        TEXT        NOT NULL,
  "username"     TEXT        NOT NULL,
  "passwordHash" TEXT        NOT NULL,
  "role"         "Role"      NOT NULL DEFAULT 'MEMBER',
  "trustScore"   DOUBLE PRECISION NOT NULL DEFAULT 100,
  "isActive"     BOOLEAN     NOT NULL DEFAULT true,
  "isBanned"     BOOLEAN     NOT NULL DEFAULT false,
  "bannedReason" TEXT,
  "phone"        TEXT,
  "avatarUrl"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key"    ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX        "User_email_idx"    ON "User"("email");
CREATE INDEX        "User_role_idx"     ON "User"("role");

-- ── RefreshToken ──────────────────────────────────────────────────────────────

CREATE TABLE "RefreshToken" (
  "id"        TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"    TEXT        NOT NULL,
  "tokenHash" TEXT        NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revoked"   BOOLEAN     NOT NULL DEFAULT false,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX        "RefreshToken_userId_idx"    ON "RefreshToken"("userId");
CREATE INDEX        "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- ── Circle ────────────────────────────────────────────────────────────────────

CREATE TABLE "Circle" (
  "id"                 TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
  "name"               TEXT           NOT NULL,
  "description"        TEXT,
  "contributionAmount" DECIMAL(12,2)  NOT NULL,
  "currency"           TEXT           NOT NULL DEFAULT 'USD',
  "maxMembers"         INTEGER        NOT NULL,
  "currentMembers"     INTEGER        NOT NULL DEFAULT 0,
  "frequencyDays"      INTEGER        NOT NULL,
  "status"             "CircleStatus" NOT NULL DEFAULT 'PENDING',
  "inviteCode"         TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
  "organizerId"        TEXT           NOT NULL,
  "startDate"          TIMESTAMP(3),
  "nextPaymentDate"    TIMESTAMP(3),
  "currentRound"       INTEGER        NOT NULL DEFAULT 0,
  "totalRounds"        INTEGER        NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)   NOT NULL,

  CONSTRAINT "Circle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Circle_inviteCode_key"   ON "Circle"("inviteCode");
CREATE INDEX        "Circle_organizerId_idx"  ON "Circle"("organizerId");
CREATE INDEX        "Circle_status_idx"       ON "Circle"("status");
CREATE INDEX        "Circle_inviteCode_idx"   ON "Circle"("inviteCode");

ALTER TABLE "Circle"
  ADD CONSTRAINT "Circle_organizerId_fkey"
  FOREIGN KEY ("organizerId") REFERENCES "User"("id");

-- ── CircleMember ──────────────────────────────────────────────────────────────

CREATE TABLE "CircleMember" (
  "id"             TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
  "circleId"       TEXT           NOT NULL,
  "userId"         TEXT           NOT NULL,
  "status"         "MemberStatus" NOT NULL DEFAULT 'PENDING',
  "position"       INTEGER,
  "hasReceived"    BOOLEAN        NOT NULL DEFAULT false,
  "receivedAt"     TIMESTAMP(3),
  "totalPaid"      DECIMAL(12,2)  NOT NULL DEFAULT 0,
  "missedPayments" INTEGER        NOT NULL DEFAULT 0,
  "latePayments"   INTEGER        NOT NULL DEFAULT 0,
  "joinedAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)   NOT NULL,

  CONSTRAINT "CircleMember_pkey"             PRIMARY KEY ("id"),
  CONSTRAINT "CircleMember_circleId_userId_key" UNIQUE ("circleId", "userId")
);

CREATE INDEX "CircleMember_circleId_idx" ON "CircleMember"("circleId");
CREATE INDEX "CircleMember_userId_idx"   ON "CircleMember"("userId");
CREATE INDEX "CircleMember_status_idx"   ON "CircleMember"("status");

ALTER TABLE "CircleMember"
  ADD CONSTRAINT "CircleMember_circleId_fkey"
  FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE;

ALTER TABLE "CircleMember"
  ADD CONSTRAINT "CircleMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- ── RotationSlot ──────────────────────────────────────────────────────────────

CREATE TABLE "RotationSlot" (
  "id"           TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "circleId"     TEXT          NOT NULL,
  "round"        INTEGER       NOT NULL,
  "memberId"     TEXT,
  "isPaid"       BOOLEAN       NOT NULL DEFAULT false,
  "payoutAmount" DECIMAL(12,2),
  "payoutDate"   TIMESTAMP(3),
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "RotationSlot_pkey"              PRIMARY KEY ("id"),
  CONSTRAINT "RotationSlot_circleId_round_key" UNIQUE ("circleId", "round")
);

CREATE INDEX "RotationSlot_circleId_idx" ON "RotationSlot"("circleId");

ALTER TABLE "RotationSlot"
  ADD CONSTRAINT "RotationSlot_circleId_fkey"
  FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE;

-- ── SwapRequest ───────────────────────────────────────────────────────────────

CREATE TABLE "SwapRequest" (
  "id"                TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "circleId"          TEXT         NOT NULL,
  "requesterId"       TEXT         NOT NULL,
  "currentPosition"   INTEGER      NOT NULL,
  "requestedPosition" INTEGER      NOT NULL,
  "reason"            TEXT,
  "status"            "SwapStatus" NOT NULL DEFAULT 'PENDING',
  "approvedById"      TEXT,
  "approvedAt"        TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SwapRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SwapRequest_circleId_idx"    ON "SwapRequest"("circleId");
CREATE INDEX "SwapRequest_requesterId_idx" ON "SwapRequest"("requesterId");
CREATE INDEX "SwapRequest_status_idx"      ON "SwapRequest"("status");

ALTER TABLE "SwapRequest"
  ADD CONSTRAINT "SwapRequest_circleId_fkey"
  FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE;

ALTER TABLE "SwapRequest"
  ADD CONSTRAINT "SwapRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "CircleMember"("id") ON DELETE CASCADE;

-- ── Payment ───────────────────────────────────────────────────────────────────

CREATE TABLE "Payment" (
  "id"              TEXT            NOT NULL DEFAULT gen_random_uuid()::text,
  "circleId"        TEXT            NOT NULL,
  "memberId"        TEXT            NOT NULL,
  "userId"          TEXT            NOT NULL,
  "round"           INTEGER         NOT NULL,
  "dueAmount"       DECIMAL(12,2)   NOT NULL,
  "amount"          DECIMAL(12,2)   NOT NULL,
  "currency"        TEXT            NOT NULL DEFAULT 'USD',
  "status"          "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentMethod"   TEXT,
  "lateFee"         DECIMAL(12,2)   NOT NULL DEFAULT 0,
  "platformFee"     DECIMAL(12,2)   NOT NULL DEFAULT 0,
  "isPartial"       BOOLEAN         NOT NULL DEFAULT false,
  "remainingAmount" DECIMAL(12,2)   NOT NULL DEFAULT 0,
  "reference"       VARCHAR(200),
  "idempotencyKey"  TEXT,
  "processedAt"     TIMESTAMP(3),
  "failureReason"   TEXT,
  "createdAt"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)    NOT NULL,

  CONSTRAINT "Payment_pkey"              PRIMARY KEY ("id"),
  CONSTRAINT "Payment_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE INDEX "Payment_circleId_idx" ON "Payment"("circleId");
CREATE INDEX "Payment_memberId_idx" ON "Payment"("memberId");
CREATE INDEX "Payment_userId_idx"   ON "Payment"("userId");
CREATE INDEX "Payment_status_idx"   ON "Payment"("status");
CREATE INDEX "Payment_round_idx"    ON "Payment"("round");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_circleId_fkey"
  FOREIGN KEY ("circleId") REFERENCES "Circle"("id");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "CircleMember"("id");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id");

-- ── LedgerEntry ───────────────────────────────────────────────────────────────

CREATE TABLE "LedgerEntry" (
  "id"            TEXT                NOT NULL DEFAULT gen_random_uuid()::text,
  "circleId"      TEXT                NOT NULL,
  "paymentId"     TEXT,
  "type"          "LedgerEntryType"   NOT NULL,
  "description"   TEXT                NOT NULL,
  "debitAmount"   DECIMAL(12,2)       NOT NULL,
  "creditAmount"  DECIMAL(12,2)       NOT NULL,
  "currency"      TEXT                NOT NULL DEFAULT 'USD',
  "debitAccount"  TEXT                NOT NULL,
  "creditAccount" TEXT                NOT NULL,
  "balanceAfter"  DECIMAL(12,2)       NOT NULL,
  "createdAt"     TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerEntry_circleId_idx"  ON "LedgerEntry"("circleId");
CREATE INDEX "LedgerEntry_paymentId_idx" ON "LedgerEntry"("paymentId");
CREATE INDEX "LedgerEntry_type_idx"      ON "LedgerEntry"("type");
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_circleId_fkey"
  FOREIGN KEY ("circleId") REFERENCES "Circle"("id");

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id");

-- ── ScheduledDebit ────────────────────────────────────────────────────────────

CREATE TABLE "ScheduledDebit" (
  "id"             TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "circleId"       TEXT          NOT NULL,
  "memberId"       TEXT          NOT NULL,
  "round"          INTEGER       NOT NULL,
  "amount"         DECIMAL(12,2) NOT NULL,
  "scheduledFor"   TIMESTAMP(3)  NOT NULL,
  "status"         "DebitStatus" NOT NULL DEFAULT 'SCHEDULED',
  "idempotencyKey" TEXT          NOT NULL,
  "attemptedAt"    TIMESTAMP(3),
  "completedAt"    TIMESTAMP(3),
  "failureReason"  TEXT,
  "retryCount"     INTEGER       NOT NULL DEFAULT 0,
  "nextRetryAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "ScheduledDebit_pkey"             PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledDebit_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

CREATE INDEX "ScheduledDebit_circleId_idx"    ON "ScheduledDebit"("circleId");
CREATE INDEX "ScheduledDebit_scheduledFor_idx" ON "ScheduledDebit"("scheduledFor");
CREATE INDEX "ScheduledDebit_status_idx"      ON "ScheduledDebit"("status");

ALTER TABLE "ScheduledDebit"
  ADD CONSTRAINT "ScheduledDebit_circleId_fkey"
  FOREIGN KEY ("circleId") REFERENCES "Circle"("id");

-- ── TrustEvent ────────────────────────────────────────────────────────────────

CREATE TABLE "TrustEvent" (
  "id"         TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"     TEXT         NOT NULL,
  "circleId"   TEXT,
  "eventType"  TEXT         NOT NULL,
  "delta"      DOUBLE PRECISION NOT NULL,
  "scoreAfter" DOUBLE PRECISION NOT NULL,
  "metadata"   JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrustEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrustEvent_userId_idx"    ON "TrustEvent"("userId");
CREATE INDEX "TrustEvent_circleId_idx"  ON "TrustEvent"("circleId");
CREATE INDEX "TrustEvent_eventType_idx" ON "TrustEvent"("eventType");

ALTER TABLE "TrustEvent"
  ADD CONSTRAINT "TrustEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- ── Notification ──────────────────────────────────────────────────────────────

CREATE TABLE "Notification" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"    TEXT         NOT NULL,
  "circleId"  TEXT,
  "type"      TEXT         NOT NULL,
  "title"     TEXT         NOT NULL,
  "body"      TEXT         NOT NULL,
  "isRead"    BOOLEAN      NOT NULL DEFAULT false,
  "readAt"    TIMESTAMP(3),
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_idx"   ON "Notification"("userId");
CREATE INDEX "Notification_isRead_idx"   ON "Notification"("isRead");
CREATE INDEX "Notification_circleId_idx" ON "Notification"("circleId");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_circleId_fkey"
  FOREIGN KEY ("circleId") REFERENCES "Circle"("id");

-- ── IdempotencyKey ────────────────────────────────────────────────────────────

CREATE TABLE "IdempotencyKey" (
  "id"         TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "key"        TEXT         NOT NULL,
  "userId"     TEXT         NOT NULL,
  "response"   JSONB        NOT NULL,
  "statusCode" INTEGER      NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyKey_key_key"    ON "IdempotencyKey"("key");
CREATE INDEX        "IdempotencyKey_key_idx"    ON "IdempotencyKey"("key");
CREATE INDEX        "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- ── AuditLog ──────────────────────────────────────────────────────────────────

CREATE TABLE "AuditLog" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"    TEXT,
  "action"    TEXT         NOT NULL,
  "entity"    TEXT         NOT NULL,
  "entityId"  TEXT         NOT NULL,
  "ip"        TEXT,
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL;