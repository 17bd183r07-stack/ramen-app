// Firebase の「プロジェクトの設定」→「マイアプリ」に表示される設定をここに貼ります。
// パスワードではなく公開して問題ない値です。データの守りは firestore.rules が担当します。
export const firebaseConfig = {
  apiKey: "AIzaSyCV5vJunbRMbNQdvXdeADPQJkJvNMYUAh0",
  authDomain: "ramen-cho.firebaseapp.com",
  projectId: "ramen-cho",
  storageBucket: "ramen-cho.firebasestorage.app",
  messagingSenderId: "16318254649",
  appId: "1:16318254649:web:7b643c628f0cc4418847e8"
};

// Googleマップの店舗検索用のキー（空のときは OpenStreetMap で検索する）
// Google Cloud で「このサイトからのみ使える」制限をかけたキーなので、公開しても他では使えません
export const MAPS_API_KEY = "AIzaSyBg1fNyHUInosy3oAb7neQahiPz9kps0Kc";
