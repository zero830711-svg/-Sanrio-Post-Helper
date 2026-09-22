# X archive media import

Branch: `feature/x-archive-media-import`

The archive contains about 2,810 posts, 6,311 ordinary images and 53 videos.
This feature keeps archive bytes on Lolipop and stores only metadata in MySQL.

## Added files

- `server/lolipop/archive-media-schema.sql`: metadata table `sanrio_post_media`.
- `server/lolipop/archive-media.php`: authenticated multipart upload endpoint.

## Safety rules

- Do not upload the archive ZIP to GitHub.
- Do not commit `config.php), sync keys, database credentials, or media.
- Stored filenames are SHA-256 based; original filenames are metadata only.
- Duplicate media for the same post is ignored by `(post_id, sha256)`.
- Existing `sanrio_post_sync` rows are untouched.

## Next integration step

The browser importer should parse `data/tweets.js`, match `tweet.id` to the existing `postId`, upload each media file in resumable batches, and merge only archive fields. It must preserve `lastRepostedAt`, `repostCount`, `candidateExcluded`, and analytics fields.
