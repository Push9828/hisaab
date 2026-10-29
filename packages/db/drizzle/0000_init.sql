CREATE TYPE "public"."AccountKind" AS ENUM('BANK', 'CREDIT_CARD', 'RECEIVABLE', 'PAYABLE', 'LOAN');--> statement-breakpoint
CREATE TYPE "public"."TxStatus" AS ENUM('CONFIRMED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."TxType" AS ENUM('INCOME', 'EXPENSE', 'TRANSFER', 'SPLIT', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "Account" (
	"id" text PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"name" text NOT NULL,
	"kind" "AccountKind" NOT NULL,
	"openingBalance" bigint DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Account_alias_key" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "Entry" (
	"id" text PRIMARY KEY NOT NULL,
	"transactionId" text NOT NULL,
	"accountId" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "Entry_amount_nonzero" CHECK ("Entry"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ProcessedMessage" (
	"channel" text NOT NULL,
	"externalId" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ProcessedMessage_channel_externalId_pk" PRIMARY KEY("channel","externalId")
);
--> statement-breakpoint
CREATE TABLE "Transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "TxType" NOT NULL,
	"occurredAt" timestamp (3) with time zone NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"spendAmount" bigint DEFAULT 0 NOT NULL,
	"status" "TxStatus" DEFAULT 'CONFIRMED' NOT NULL,
	"voidedAt" timestamp (3) with time zone,
	"channel" text NOT NULL,
	"externalId" text NOT NULL,
	"rawText" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "Transaction_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	CONSTRAINT "Transaction_seq_key" UNIQUE("seq"),
	CONSTRAINT "Transaction_channel_externalId_key" UNIQUE("channel","externalId"),
	CONSTRAINT "Transaction_spendAmount_nonneg" CHECK ("Transaction"."spendAmount" >= 0),
	CONSTRAINT "Transaction_spendAmount_zero_for_non_spend" CHECK ("Transaction"."type" NOT IN ('TRANSFER', 'ADJUSTMENT', 'INCOME') OR "Transaction"."spendAmount" = 0)
);
--> statement-breakpoint
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_transactionId_Transaction_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."Transaction"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_accountId_Account_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Entry_accountId_idx" ON "Entry" USING btree ("accountId");--> statement-breakpoint
CREATE INDEX "Entry_transactionId_idx" ON "Entry" USING btree ("transactionId");