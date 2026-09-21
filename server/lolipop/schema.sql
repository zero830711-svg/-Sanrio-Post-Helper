CREATE TABLE IF NOT EXISTS sanrio_post_sync (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  canonical_key VARCHAR(191) NULL,
  payload LONGTEXT NOT NULL,
  client_updated_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_canonical_key (canonical_key),
  INDEX idx_updated_at (updated_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
