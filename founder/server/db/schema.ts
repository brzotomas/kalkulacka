import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const documents = sqliteTable('founder_documents', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull(),
  updatedAt: text('updated_at').notNull(),
  mutationId: text('mutation_id').notNull(),
});
