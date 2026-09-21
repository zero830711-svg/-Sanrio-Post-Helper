<?php
// config.php にコピーして、ロリポップ上だけで編集してください。
// このファイルに本番パスワードを書いたまま GitHub へコミットしないでください。

return [
    'db_dsn' => 'mysql:host=MYSQL_HOST;dbname=MYSQL_DATABASE;charset=utf8mb4',
    'db_user' => 'MYSQL_USER',
    'db_password' => 'MYSQL_PASSWORD',

    // 32文字以上の推測されにくい文字列を推奨
    'sync_key' => 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET',

    // GitHub Pages の公開元。必要なら自分の独自ドメインも追加。
    'allowed_origins' => [
        'https://zero830711-svg.github.io',
    ],
];
