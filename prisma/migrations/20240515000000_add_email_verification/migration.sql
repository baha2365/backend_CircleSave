-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0002_add_email_verification
-- Adds email verification and password reset OTP fields to the User table
-- ─────────────────────────────────────────────────────────────────────────────

-- Email verification columns
ALTER TABLE "User"
  ADD COLUMN "isVerified"              BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN "verificationToken"       TEXT,
  ADD COLUMN "verificationTokenExpiry" TIMESTAMP(3);

-- Password reset columns
ALTER TABLE "User"
  ADD COLUMN "passwordResetToken"       TEXT,
  ADD COLUMN "passwordResetTokenExpiry" TIMESTAMP(3);

-- Unique constraints (a token must belong to exactly one user)
CREATE UNIQUE INDEX "User_verificationToken_key"   ON "User"("verificationToken");
CREATE UNIQUE INDEX "User_passwordResetToken_key"   ON "User"("passwordResetToken");

-- Indexes for fast token lookups during verify / reset flows
CREATE INDEX "User_verificationToken_idx"   ON "User"("verificationToken");
CREATE INDEX "User_passwordResetToken_idx"  ON "User"("passwordResetToken");