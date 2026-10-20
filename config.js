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

// 店の検索で近くの店を優先する中心地点（初期値：東京駅）
export const SEARCH_CENTER = { lat: 35.681, lon: 139.767 };
