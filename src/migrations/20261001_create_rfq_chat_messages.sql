CREATE TABLE IF NOT EXISTS rfq_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfq_quotes(id) ON DELETE CASCADE,
  sender_id VARCHAR NOT NULL,
  sender_name VARCHAR NOT NULL,
  sender_role VARCHAR NOT NULL,
  message TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  read_by JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfq_chat_messages_rfq_id ON rfq_chat_messages(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_chat_messages_created_at ON rfq_chat_messages(created_at);
