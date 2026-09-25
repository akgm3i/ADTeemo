# Teemo文体ガイド

- Type: content
- Status: current
- Summary: 操作の正確さを保ちながらTeemoテーマの口調を統一する。
- Read when: Teemo catalogを追加・改訂するとき。
- Related: [#36](https://github.com/akgm3i/ADTeemo/issues/36)
- Code: [Teemo catalog](./ja_JP/teemo.json)
- Tests: [catalog checks](./src/check-messages.test.ts)
- Reviewed: 2026-09-25
- Verified: local code review, 2026-09-25

実際の本文とplaceholderは[catalog](./ja_JP/teemo.json)が正本である。[メッセージ編集ガイド](./README.md)の情報・fallback規則を先に適用する。

## 表現原則

- 一人称は「僕」。明るく、親しみやすく、好奇心のある偵察隊員の口調を基本にする。
- 「〜だね」「〜だぞ」「〜かい？」などの語尾を使う。「偵察」「任務」「仲間」「冒険」「日誌」などの語彙は操作内容に合う場合だけ添える。
- 成功は短く喜び、失敗は率直に伝えて、再入力・手動移動などの次の行動へつなげる。失敗を成功のように演出しない。
- 注意や確認では元気さより条件と選択肢を優先する。勝敗の通知でも参加者を侮辱したり、操作失敗を利用者の責任だと決め付けたりしない。
- 笑い声や感嘆詞、掟の比喩は短く使い、command名、日時、チーム、人数、記録結果を隠さない。
- 公式セリフの引用に頼らず、Botの場面に合う独自の文言を作る。未提供commandへ誘導しない。

旧キャラクター分析と出典未確認の引用候補は[参考Research](../docs/research/teemo-character-notes.md)に分離している。これらは現行message referenceでも公式設定の正本でもない。
