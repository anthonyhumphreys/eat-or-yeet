CREATE TABLE warning_browse(id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, region TEXT NOT NULL, status TEXT NOT NULL, is_demo INTEGER NOT NULL, starts_at REAL NOT NULL, ends_at REAL, updated_at REAL NOT NULL, hazard_kind TEXT NOT NULL, search_text TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
-- statement-breakpoint
CREATE INDEX warning_browse_region_order ON warning_browse(region, status, is_demo, updated_at DESC, id ASC);
-- statement-breakpoint
CREATE TABLE warning_browse_facets(browse_id TEXT NOT NULL, facet TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(browse_id, facet, value));
-- statement-breakpoint
CREATE INDEX warning_browse_facet_lookup ON warning_browse_facets(facet, value, browse_id);
-- statement-breakpoint
CREATE VIRTUAL TABLE warning_search USING fts5(search_text, content='warning_browse', content_rowid='rowid', tokenize='trigram');
-- statement-breakpoint
CREATE TRIGGER warning_browse_insert AFTER INSERT ON warning_browse BEGIN
  INSERT INTO warning_search(rowid, search_text) VALUES (new.rowid, new.search_text);
END;
-- statement-breakpoint
CREATE TRIGGER warning_browse_delete AFTER DELETE ON warning_browse BEGIN
  INSERT INTO warning_search(warning_search, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
END;
-- statement-breakpoint
CREATE TRIGGER warning_browse_update AFTER UPDATE ON warning_browse BEGIN
  INSERT INTO warning_search(warning_search, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO warning_search(rowid, search_text) VALUES (new.rowid, new.search_text);
END;
-- statement-breakpoint
CREATE TABLE warning_browse_dirty(id TEXT NOT NULL, region TEXT NOT NULL, PRIMARY KEY(id, region));
-- statement-breakpoint
CREATE INDEX warning_browse_dirty_region ON warning_browse_dirty(region);
-- statement-breakpoint
CREATE TRIGGER warning_record_insert AFTER INSERT ON records WHEN new.table_name='incidentMatchData' BEGIN
  INSERT INTO warning_browse_dirty SELECT new.id, json_extract(new.payload, '$.region') WHERE NOT EXISTS(SELECT 1 FROM warning_browse_dirty WHERE id=new.id AND region=json_extract(new.payload, '$.region'));
END;
-- statement-breakpoint
CREATE TRIGGER warning_record_update AFTER UPDATE ON records WHEN new.table_name='incidentMatchData' BEGIN
  INSERT INTO warning_browse_dirty SELECT old.id, json_extract(old.payload, '$.region') WHERE NOT EXISTS(SELECT 1 FROM warning_browse_dirty WHERE id=old.id AND region=json_extract(old.payload, '$.region'));
  INSERT INTO warning_browse_dirty SELECT new.id, json_extract(new.payload, '$.region') WHERE NOT EXISTS(SELECT 1 FROM warning_browse_dirty WHERE id=new.id AND region=json_extract(new.payload, '$.region'));
END;
-- statement-breakpoint
CREATE TRIGGER warning_record_delete AFTER DELETE ON records WHEN old.table_name='incidentMatchData' BEGIN
  DELETE FROM warning_browse WHERE id=old.id;
  DELETE FROM warning_browse_facets WHERE browse_id=old.id;
  DELETE FROM warning_browse_dirty WHERE id=old.id;
END;
-- statement-breakpoint
INSERT INTO warning_browse_dirty SELECT id, json_extract(payload, '$.region') FROM records WHERE table_name='incidentMatchData';
