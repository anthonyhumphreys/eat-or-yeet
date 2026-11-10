CREATE INDEX fdaMonitorControl_by_key ON records(json_extract(payload, '$.key'), created_at, id) WHERE table_name='fdaMonitorControl';
CREATE INDEX fdaMonitorNotices_by_path ON records(json_extract(payload, '$.path'), created_at, id) WHERE table_name='fdaMonitorNotices';
CREATE INDEX fdaMonitorNotices_by_pending ON records(json_extract(payload, '$.pending'), created_at, id) WHERE table_name='fdaMonitorNotices';
CREATE INDEX fdaMonitorReceipts_by_key ON records(json_extract(payload, '$.key'), created_at, id) WHERE table_name='fdaMonitorReceipts';
CREATE INDEX fdaMonitorReceipts_by_expiresAt ON records(json_extract(payload, '$.expiresAt'), created_at, id) WHERE table_name='fdaMonitorReceipts';
