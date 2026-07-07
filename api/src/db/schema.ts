import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  hotmartUserId: text("hotmart_user_id").unique(),
  role: text("role").notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const subscriptions = sqliteTable("subscriptions", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  hotmartSubscriberCode: text("hotmart_subscriber_code"),
  plan: text("plan"),
  status: text("status").notNull().default("none"),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
});
