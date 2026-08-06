CREATE UNIQUE INDEX "reviews_run_uidx" ON "reviews" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_task_round_uidx" ON "reviews" USING btree ("task_id","round");