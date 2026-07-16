DROP INDEX "busabase_field_values_base_field_text_idx";--> statement-breakpoint
CREATE INDEX "busabase_field_values_base_field_idx" ON "busabase_field_values" USING btree ("base_id","field_slug");