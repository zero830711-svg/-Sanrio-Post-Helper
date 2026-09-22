<?php
// config.php にコピーして、ロリポップ上だけで編集してください。
// 本番パスワード・同期キーは GitHub にコミットしないでください。

return [
    'db_dsn' => 'mysql:host=MYSQL_HOST;dbname=MYSQL_DATABASE;charset=utf8mb4',
    'db_user' => 'MYSQL_USER',
    'db_password' => 'MYSQL_PASSWORD',
    'sync_key' => 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET',

    // Xアーカイブ画像・動画の保存先。Web公開領域内の専用ディレクトリを指定。
    'media_root' => '/home/USER/www/sanrio-media',
    'media_public_base' => 'https://example.com/sanrio-media',

    'allowed_origins' => [
        'https://zero830711-svg.github.io',
    ],
];
