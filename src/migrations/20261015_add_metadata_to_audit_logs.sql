-- Add metadata JSONB column to audit_logs if not exists
ALTER TABLE audit_logs 
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- Create performance indexes for sorting and filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_name ON audit_logs (entity_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action, created_at DESC);
