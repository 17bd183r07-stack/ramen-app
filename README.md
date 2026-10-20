# 部内ラーメン帖

部内メンバーが、ラーメン店を味の種類ごとの順位で評価し合うWebアプリです。

## 仕組み

| 役割 | 使うもの | 費用 |
| --- | --- | --- |
| アプリの置き場所（URL） | GitHub Pages | 0円 |
| Googleアカウントでのログイン | Firebase Authentication | 0円（Sparkプラン） |
| 順位・コメント・写真の保存 | Cloud Firestore | 0円（Sparkプラン） |
| 店の検索 | Googleマップ（Places API）。キー未設定なら OpenStreetMap | 0円（1日の上限を無料枠より低く設定） |

写真はスマホ側で縮めてから Firestore に保存します（大きい写真は長い辺800px、一覧用は160px）。

## ファイル

| ファイル | 中身 |
| --- | --- |
| `index.html` / `style.css` | 画面 |
| `app.js` | 動き（ログイン、検索、投稿、ランキング） |
| `config.js` | Firebase の設定と、Googleマップのキー |
| `firestore.rules` | データの守り（招待された人だけ、本人の分だけ書ける） |

## 公開までの手順

1. `config.js` に Firebase の設定を貼る
2. Firebase コンソールの「Firestore Database」→「ルール」タブに `firestore.rules` の中身を貼り、「公開」
3. GitHub のリポジトリで「Settings」→「Pages」→ Branch を `main`、フォルダを `/ (root)` にして「Save」
4. Firebase コンソールの「Authentication」→「設定」→「承認済みドメイン」に `〇〇.github.io` を追加
5. 管理者が最初にアプリを開いてログインする（最初にログインした人が管理者になる）
6. マイページの「メンバーの招待」で、メンバーのGoogleアカウントのメールアドレスを登録する

## データの守り（firestore.rules）

- 招待リストにないアカウントは、ログインしても何も見られない
- 順位・コメント・写真は本人しか書き換え・削除できない
- 招待とメンバーの削除、お店の削除は管理者だけ
- 同じ OpenStreetMap の店は2つ目を登録できない

## Googleマップの店舗データの扱い

Google の規約で、アプリに保存してよいのは店ごとの番号（placeId）です。店の住所はお店の画面を開くたびに Google から取り寄せ、保存しません。
