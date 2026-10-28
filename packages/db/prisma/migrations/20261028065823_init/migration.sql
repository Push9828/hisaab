-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('BANK', 'CREDIT_CARD', 'RECEIVABLE', 'PAYABLE', 'LOAN');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'SPLIT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('CONFIRMED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "openingBalance" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "type" "TxType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "spendAmount" BIGINT NOT NULL DEFAULT 0,
    "status" "TxStatus" NOT NULL DEFAULT 'CONFIRMED',
    "voidedAt" TIMESTAMP(3),
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedMessage" (
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedMessage_pkey" PRIMARY KEY ("channel","externalId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_alias_key" ON "Account"("alias");

-- CreateIndex
CREATE INDEX "Transaction_voidedAt_occurredAt_idx" ON "Transaction"("voidedAt", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_channel_externalId_key" ON "Transaction"("channel", "externalId");

-- CreateIndex
CREATE INDEX "Entry_accountId_idx" ON "Entry"("accountId");

-- CreateIndex
CREATE INDEX "Entry_transactionId_idx" ON "Entry"("transactionId");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written constraints (Prisma cannot express CHECKs).
-- Hard rule 3 is enforced here as well as in core's checkInvariants.
ALTER TABLE "Account" ADD CONSTRAINT "Account_alias_lowercase" CHECK ("alias" = lower("alias"));
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spendAmount_nonneg" CHECK ("spendAmount" >= 0);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_no_spend_on_transfer_adjustment"
  CHECK ("type" NOT IN ('TRANSFER', 'ADJUSTMENT') OR "spendAmount" = 0);
