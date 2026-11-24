// node --test test/nowPlayingWatcher.test.js
const test = require('node:test');
const assert = require('node:assert');
const { NowPlayingWatcher, parseTasklistCsv } = require('../src/lib/nowPlayingWatcher');

const row = (title) => `"PotPlayerMini64.exe","1234","Console","1","120,000 K","Running","PC\\Bsy","0:01:02","${title}"`;

test('parseTasklistCsv 取最後一欄視窗標題', () => {
  assert.deepStrictEqual(parseTasklistCsv(row('沒那麼簡單 - 黃小琥.mp3 - PotPlayer')), ['沒那麼簡單 - 黃小琥.mp3 - PotPlayer']);
});

test('parseTasklistCsv 忽略訊息列與閒置標題', () => {
  const out = ['資訊: 沒有執行中的工作符合指定的準則。', row('PotPlayer'), row('N/A'), ''].join('\r\n');
  assert.deepStrictEqual(parseTasklistCsv(out), []);
});

function fakeExec(seq) {
  // seq:每次 tick 要回的標題('' = 沒有)
  let i = 0;
  return (cmd, args, opts, cb) => {
    const t = seq[Math.min(i++, seq.length - 1)];
    cb(null, JSON.stringify(t ? [t] : []));
  };
}

test('換歌才 emit;關掉要連續兩次抓不到才 emit 空字串', async () => {
  const w = new NowPlayingWatcher({ exec: fakeExec(['A - X.mp3 - PotPlayer', 'A - X.mp3 - PotPlayer', 'B - Y.mp3 - PotPlayer', '', '']), platform: 'win32' });
  const got = [];
  w.on('change', (t) => got.push(t));
  for (let k = 0; k < 5; k++) await w._tick();
  assert.deepStrictEqual(got, ['A - X.mp3 - PotPlayer', 'B - Y.mp3 - PotPlayer', '']);
});

test('換歌瞬間只閃一次空 → 不 emit 空字串', async () => {
  const w = new NowPlayingWatcher({ exec: fakeExec(['A - X.mp3 - PotPlayer', '', 'B - Y.mp3 - PotPlayer']), platform: 'win32' });
  const got = [];
  w.on('change', (t) => got.push(t));
  for (let k = 0; k < 3; k++) await w._tick();
  assert.deepStrictEqual(got, ['A - X.mp3 - PotPlayer', 'B - Y.mp3 - PotPlayer']);
});

test('非 Windows 不啟動', () => {
  const w = new NowPlayingWatcher({ platform: 'darwin' });
  assert.strictEqual(w.start(), false);
});

test('停止後不接受仍在執行的查詢結果', async () => {
  let done;
  const w = new NowPlayingWatcher({ exec: (_cmd, _args, _opts, cb) => { done = cb; } });
  const got = [];
  w.on('change', (s) => got.push(s));
  const pending = w._tick();
  w.stop();
  done(null, JSON.stringify(['晴天 - 周杰倫.mp3 - PotPlayer']));
  await pending;
  assert.deepStrictEqual(got, []);
  assert.strictEqual(w.current, '');
});

test('UTF-8 中文與關閉後重開同一首都能同步', async () => {
  const title = '沒那麼簡單 - 黃小琥.mp3 - PotPlayer';
  const w = new NowPlayingWatcher({ exec: fakeExec([title, title]) });
  const got = [];
  w.on('change', (s) => got.push(s));
  await w._tick(); w.stop(); await w._tick();
  assert.deepStrictEqual(got, [title, '', title]);
});
