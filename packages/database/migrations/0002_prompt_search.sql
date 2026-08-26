CREATE VIRTUAL TABLE prompts_fts USING fts5(
  text,
  content='prompts',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER prompts_fts_insert AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts (rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER prompts_fts_delete AFTER DELETE ON prompts BEGIN
  INSERT INTO prompts_fts (prompts_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER prompts_fts_update AFTER UPDATE ON prompts BEGIN
  INSERT INTO prompts_fts (prompts_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO prompts_fts (rowid, text) VALUES (new.rowid, new.text);
END;
