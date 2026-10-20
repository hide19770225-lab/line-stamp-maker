# iPhoneの40個・5列×8段切替エラー

## 原因と修正

かんたん読み込みは最初に2列×5段で加工・候補作成する。その際に検出した`columnYs`は2列分。`StampProject.setGrid`は列・段数と共通線だけを更新していたため、5列×8段への変更後も2列分が残り、`drawSplit`の3列目でundefinedを反復して例外が発生した。Safari固有のAPI問題ではなく、配置と列別境界の状態不整合。

配置変更時は列別境界・手動列別フラグ・不確実判定・旧切抜き診断を破棄する。描画も欠落列には共通横線を使う。新しい配置で再加工すると5列分の境界を再検出する。番号別セリフ・個別設定は既存処理のまま保持。

バージョン不明は、`build-info.js`のソース用nullを直接配信していたことが原因。GitHub Pages用のビルド設定はあったがNetlify用設定はなかった。`netlify.toml`で`node scripts/build.cjs`と`dist`配信を指定し、Netlifyの`COMMIT_REF`と`CONTEXT`をメタデータに使う。表示は1.0.1。成果物ごとのキャッシュキーも既存ビルドで付与される。ソース直配信時は引き続き実在しないビルド情報を捏造しない。

## 検証

- 単体79件成功（自動/手動列別状態から5×8へ変更する回帰とNetlifyビルド情報検査を含む）。
- 既存`individual-adjustments-browser.cjs`：10個/40個、個別変更の分離、再加工、JSON保存復元、ZIPの全PNGと描画PNGのバイト一致が成功。
- `version-browser.cjs`：不明状態、JST表示、両モードでの表示、古いビルドの検出、オフライン、再読み込み取消が成功。
- 1枚5×8の構成画像：40個全編集画面、ページ例外0、ZIPの01〜40.pngが描画PNGとバイト一致。全40枚RGBA・370×320、main 240×240、tab 96×74、42エントリCRC正常。一括検査42画像エラー0。境界確認チェックはテスト内で操作しており、全画像の品質を人が承認したという意味ではない。
- Netlify相当のビルド成果物で`Ver. 1.0.1`、コミット、`deploy-preview`、配信中ビルド一致を確認。

追加の1枚5×8検証：

```sh
python tests/prepare_40_sheet.py tests/fixtures/BBE9DC5F-F70D-490D-B5E3-40E2D682218B.png /tmp/artwork40.png
STAMP_TEST_URL=http://127.0.0.1:4174 STAMP_TEST_IMAGE=/tmp/artwork40.png node tests/single-sheet-40-browser.cjs
```

`STAMP_TEST_IMAGE`には実際の40個画像も指定できる。テストは2列分の旧境界を明示的に残した状態からUIで5×8へ変更し、40個すべての個別調節画面とZIP出力を検査する。

今回手元にある実画像は2×5の10個入りのみ。上の40枠画像は実イラスト10個を4回配置した検証用画像であり、ユーザーの再現用40個入り原画像ではない。ChromiumのiPhone 13エミュレーションを使用し、実機iPhone Safariは未検証。元の40個画像による最終検証は画像入手後に必要。
