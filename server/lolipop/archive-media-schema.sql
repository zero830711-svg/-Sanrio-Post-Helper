-- X archive media metadata. Media bytes stay on Lolipop filesystem; GitHub stores only this schema.
CREATE TABLE IF NOT EXISTS sanrio_post_media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  post_id VARCHAR(64) NOT NULL,
  media_type ENUM('image','video','gif','other') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  public_url VARCHAR(1000) NULL,
  mime_type VARCHAR(100) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_post_media_hash (post_id, sha256),
  KEY idx_post_id (post_id),
  KEY idx_sha256 (sha256)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
