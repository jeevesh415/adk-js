CREATE TABLE "app_states" (
	"app_name" text PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"update_time" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text NOT NULL,
	"app_name" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"invocation_id" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"event_data" jsonb,
	CONSTRAINT "events_app_name_user_id_session_id_id_pk" PRIMARY KEY("app_name","user_id","session_id","id")
);
--> statement-breakpoint
CREATE TABLE "adk_internal_metadata" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"app_name" text NOT NULL,
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"create_time" bigint NOT NULL,
	"last_update_time" bigint NOT NULL,
	CONSTRAINT "sessions_app_name_user_id_id_pk" PRIMARY KEY("app_name","user_id","id")
);
--> statement-breakpoint
CREATE TABLE "user_states" (
	"app_name" text NOT NULL,
	"user_id" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"update_time" bigint NOT NULL,
	CONSTRAINT "user_states_app_name_user_id_pk" PRIMARY KEY("app_name","user_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_fkey" FOREIGN KEY ("app_name","user_id","session_id") REFERENCES "public"."sessions"("app_name","user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_session_idx" ON "events" USING btree ("app_name","user_id","session_id");