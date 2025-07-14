// app.js 全機能実装

const ENDPOINT = '<<あなたの GAS exec URL >>';
const SECRET = 'kosen-brain-super-secret';
const SCAN_COOLDOWN_MS = 1500;
const POLL_INTERVAL_MS = 20000;
const MAX_UNDO = 3;

let qrReader = null;
let rankingQrReader = null;
let qrActive = false;
let isRankingMode = false;

let currentSeatId = null;
let rankingSeatId = null;

let lastScanTime = 0;
let lastScannedText = '';

let pollTimer = null;
let isSaving = false;
let msgTimer = null;

let seatMap = {};
let playerData = {};
let actionHistory = [];

const delay = ms => new Promise(res => setTimeout(res, ms));

function displayMessage(msg) {
  const area = document.getElementById('messageArea');
  if (!area) return;
  area.textContent = msg;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (area.textContent = ''), 3000);
}

// ローカルストレージ読み込み/保存
function saveToLocalStorage() {
  localStorage.setItem('seatMap', JSON.stringify(seatMap));
  localStorage.setItem('playerData', JSON.stringify(playerData));
}
function loadFromLocalStorage() {
  seatMap = JSON.parse(localStorage.getItem('seatMap') || '{}');
  playerData = JSON.parse(localStorage.getItem('playerData') || '{}');
}

function initCamera() {
  if (qrActive) return;
  if (!qrReader) qrReader = new Html5Qrcode('reader');
  qrReader.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, handleScanSuccess)
    .then(() => (qrActive = true))
    .catch(err => {
      console.error(err);
      displayMessage('❌ カメラの起動に失敗しました');
    });
}

function stopCamera() {
  if (qrReader && qrActive) {
    qrReader.stop().then(() => {
      qrReader.clear();
      qrActive = false;
    });
  }
}

function handleScanSuccess(decodedText) {
  const now = Date.now();
  if (decodedText === lastScannedText && now - lastScanTime < SCAN_COOLDOWN_MS) return;
  lastScanTime = now;
  lastScannedText = decodedText;

  if (!isRankingMode) {
    if (decodedText.startsWith('table')) {
      currentSeatId = decodedText;
      seatMap[currentSeatId] ??= [];
      displayMessage(`✅ 座席セット: ${currentSeatId}`);
    } else if (decodedText.startsWith('player')) {
      if (!currentSeatId) {
        displayMessage('⚠ 先に座席QRを読み込んでください');
        return;
      }
      if (seatMap[currentSeatId].includes(decodedText)) {
        displayMessage('⚠ 既に登録済み');
        return;
      }
      if (seatMap[currentSeatId].length >= 6) {
        displayMessage('⚠ この座席は6人まで');
        return;
      }
      seatMap[currentSeatId].push(decodedText);
      playerData[decodedText] ??= { nickname: decodedText, rate: 50, lastRank: null, bonus: 0 };
      actionHistory.push({ type: 'addPlayer', seatId: currentSeatId, playerId: decodedText });
      displayMessage(`✅ ${decodedText} 追加`);
      saveToLocalStorage();
      renderSeats();
    }
  }
  if (isRankingMode && decodedText.startsWith('table')) {
    handleRankingMode(decodedText);
    displayMessage(`✅ 座席 ${decodedText} 読み取り成功`);
    stopRankingCamera();
  }
}

function renderSeats() {
  const seatList = document.getElementById('seatList');
  seatList.innerHTML = '';
  Object.keys(seatMap).forEach(seatId => {
    const block = document.createElement('div');
    block.className = 'seat-block';

    const title = document.createElement('h3');
    title.textContent = `座席: ${seatId}`;

    const removeSeat = document.createElement('span');
    removeSeat.textContent = '✖';
    removeSeat.className = 'remove-button';
    removeSeat.tabIndex = 0;
    removeSeat.title = `座席 ${seatId} を削除`;
    removeSeat.onclick = () => {
      if (confirm(`座席 ${seatId} を削除しますか？`)) {
        actionHistory.push({ type: 'removeSeat', seatId, players: [...seatMap[seatId]] });
        delete seatMap[seatId];
        saveToLocalStorage();
        renderSeats();
        displayMessage(`座席 ${seatId} 削除`);
      }
    };
    removeSeat.onkeypress = e => { if (e.key === 'Enter') removeSeat.onclick(); };

    title.appendChild(removeSeat);
    block.appendChild(title);

    seatMap[seatId].forEach(pid => {
      const p = playerData[pid];
      const rc = p.bonus ?? 0;
      const div = document.createElement('div');
      div.className = 'player-entry';

      div.innerHTML = `
        <div>
          <strong>${pid}</strong>
          ${p.title ? `<span class="title-badge title-${p.title}">${p.title}</span>` : ''}
          <span style="margin-left:10px;color:#888;">Rate: ${p.rate}</span>
          <span class="rate-change ${rc > 0 ? 'rate-up' : rc < 0 ? 'rate-down' : 'rate-zero'}">
            ${rc > 0 ? '↑' : rc < 0 ? '↓' : '±'}${Math.abs(rc)}
          </span>
        </div>
      `;
      const btn = document.createElement('span');
      btn.className = 'remove-button';
      btn.textContent = '✖';
      btn.tabIndex = 0;
      btn.title = `プレイヤー ${pid} を削除`;
      btn.onclick = () => removePlayer(seatId, pid);
      btn.onkeypress = e => { if (e.key === 'Enter') btn.onclick(); };

      div.appendChild(btn);
      block.appendChild(div);
    });

    seatList.appendChild(block);
  });
}

function removePlayer(seatId, playerId) {
  const idx = seatMap[seatId]?.indexOf(playerId);
  if (idx === -1) return;
  seatMap[seatId].splice(idx, 1);
  actionHistory.push({ type: 'removePlayer', seatId, playerId, index: idx });
  saveToLocalStorage();
  renderSeats();
  displayMessage(`プレイヤー ${playerId} を削除`);
}

function undoAction() {
  let count = 0;
  while (count < MAX_UNDO && actionHistory.length > 0) {
    const last = actionHistory.pop();
    switch (last.type) {
      case 'addPlayer':
        seatMap[last.seatId] = seatMap[last.seatId].filter(p => p !== last.playerId);
        break;
      case 'removePlayer':
        seatMap[last.seatId]?.splice(last.index, 0, last.playerId);
        break;
      case 'removeSeat':
        seatMap[last.seatId] = last.players;
        break;
    }
    count++;
  }
  saveToLocalStorage();
  renderSeats();
  displayMessage(`操作を${count}回分取り消しました`);
}

// --- 順位登録モード ---

function startRankingCamera() {
  if (rankingQrReader) return;
  rankingQrReader = new Html5Qrcode('rankingReader');
  rankingQrReader.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, rankingScanSuccess)
    .catch(err => displayMessage('順位登録カメラ起動失敗'));
}
function stopRankingCamera() {
  if (!rankingQrReader) return;
  rankingQrReader.stop().then(() => rankingQrReader.clear());
  rankingQrReader = null;
}

function rankingScanSuccess(text) {
  if (!text.startsWith('table')) return;
  rankingSeatId = text;
  renderRankingList(rankingSeatId);
}

function renderRankingList(seatId) {
  const rankingList = document.getElementById('rankingList');
  rankingList.innerHTML = '';
  if (!seatMap[seatId]) {
    displayMessage('座席にメンバーがいません');
    return;
  }
  seatMap[seatId].forEach(pid => {
    const p = playerData[pid];
    const li = document.createElement('li');
    li.textContent = pid + ' (Rate: ' + p.rate + ')';
    li.setAttribute('draggable', true);
    li.dataset.playerId = pid;
    rankingList.appendChild(li);
  });
  enableDragSort(rankingList);
}

function enableDragSort(list) {
  let dragSrcEl = null;

  function handleDragStart(e) {
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.classList.add('dragging');
  }

  function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
  }

  function handleDragEnter() {
    if (this !== dragSrcEl) this.classList.add('over');
  }

  function handleDragLeave() {
    this.classList.remove('over');
  }

  function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    if (dragSrcEl !== this) {
      dragSrcEl.innerHTML = this.innerHTML;
      this.innerHTML = e.dataTransfer.getData('text/html');

      // スワップ dataset.playerIdも入れ替える
      const tmp = dragSrcEl.dataset.playerId;
      dragSrcEl.dataset.playerId = this.dataset.playerId;
      this.dataset.playerId = tmp;
    }
    return false;
  }

  function handleDragEnd() {
    this.classList.remove('dragging');
    Array.from(list.querySelectorAll('li')).forEach(li => li.classList.remove('over'));
  }

  Array.from(list.querySelectorAll('li')).forEach(li => {
    li.addEventListener('dragstart', handleDragStart, false);
    li.addEventListener('dragenter', handleDragEnter, false);
    li.addEventListener('dragover', handleDragOver, false);
    li.addEventListener('dragleave', handleDragLeave, false);
    li.addEventListener('drop', handleDrop, false);
    li.addEventListener('dragend', handleDragEnd, false);
  });
}

// 確定ボタン押下時のレート計算と順位確定処理
function confirmRanking() {
  if (!rankingSeatId || !seatMap[rankingSeatId]) {
    displayMessage('座席が選択されていません');
    return;
  }
  const lis = document.querySelectorAll('#rankingList li');
  const newRanks = Array.from(lis).map(li => li.dataset.playerId);
  if (newRanks.length === 0) {
    displayMessage('順位が登録されていません');
    return;
  }

  const oldRanks = seatMap[rankingSeatId] || [];

  // 前回順位を playerData に保存
  newRanks.forEach(pid => {
    playerData[pid].lastRank = oldRanks.indexOf(pid) + 1 || null;
  });

  // 新順位に対してレート計算
  calculateRate(newRanks);

  // seatMap のその座席のプレイヤー順を更新
  seatMap[rankingSeatId] = newRanks;

  // 称号更新
  updateTitles();

  saveToLocalStorage();
  renderSeats();
  displayMessage('順位が確定し、レートを更新しました');
  // リセット
  rankingSeatId = null;
  document.getElementById('rankingList').innerHTML = '';
  navigate('scan');
}

// レート計算ロジック
function calculateRate(rankedPlayers) {
  const N = rankedPlayers.length;
  if (N === 0) return;

  // ソート済みとする。indexが順位（0が1位）
  // まず、最低レート30、初期50、ボーナスリセット
  rankedPlayers.forEach(pid => {
    const p = playerData[pid];
    if (!p.rate) p.rate = 50;
    p.bonus = 0;
  });

  // ポイント計算と適用
  for (let i = 0; i < N; i++) {
    const pid = rankedPlayers[i];
    const p = playerData[pid];
    const prevRank = p.lastRank || (i + 1);
    const diff = (prevRank - (i + 1)) * 2; // 前回順位 - 今回順位 × 2

    let points = diff;

    // 特殊条件
    if (prevRank === N && i === 0) points += 8;  // 最下位→1位 +8
    if (p.rate >= 80) points = Math.floor(points * 0.8); // 80以上は0.8倍

    // 王座奪取ボーナス：トッププレイヤーより上位なら +2点
    const topRate = Math.max(...rankedPlayers.map(pid2 => playerData[pid2].rate));
    if (p.rate < topRate && i === 0) points += 2;

    p.bonus = points;

    // レート更新
    p.rate = Math.max(30, p.rate + points);
  }
}

// 称号更新：1位👑、2位🥈、3位🥉、それ以外解除
function updateTitles() {
  // 全プレイヤーのレートでソート
  const players = Object.values(playerData);
  players.sort((a, b) => b.rate - a.rate);

  players.forEach((p, i) => {
    if (i === 0) p.title = '👑';
    else if (i === 1) p.title = '🥈';
    else if (i === 2) p.title = '🥉';
    else delete p.title;
  });
}

// UI切り替え
function navigate(mode) {
  isRankingMode = mode === 'ranking';

  document.getElementById('scanSection').hidden = isRankingMode;
  document.getElementById('rankingSection').hidden = !isRankingMode;

  if (isRankingMode) {
    stopCamera();
    startRankingCamera();
  } else {
    stopRankingCamera();
    initCamera();
  }
  renderSeats();
}

// Google Driveからデータ同期
async function loadDataFromDrive() {
  try {
    const res = await fetch(ENDPOINT + '?rev=true');
    if (!res.ok) throw new Error('読み込み失敗');
    const json = await res.json();
    seatMap = json.seatMap || {};
    playerData = json.playerData || {};
    saveToLocalStorage();
    renderSeats();
    displayMessage('☁ データを同期しました');
  } catch (e) {
    displayMessage('☁ データ読み込み失敗');
    console.error(e);
  }
}
async function saveDataToDrive() {
  if (isSaving) return;
  isSaving = true;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { seatMap, playerData } }),
    });
    if (!res.ok) throw new Error('保存失敗');
    displayMessage('☁ データを保存しました');
  } catch (e) {
    displayMessage('☁ データ保存失敗');
    console.error(e);
  } finally {
    isSaving = false;
  }
}

// CSV出力
function exportCSV() {
  const rows = [['座席ID','プレイヤーID','レート','前回順位','称号','ボーナス']];
  for (const [seatId, players] of Object.entries(seatMap)) {
    players.forEach(pid => {
      const p = playerData[pid];
      rows.push([
        seatId,
        pid,
        p.rate,
        p.lastRank || '',
        p.title || '',
        p.bonus || 0
      ]);
    });
  }
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `babanuki_${new Date().toISOString()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// イベントバインド
function bindUI() {
  document.getElementById('toggleMenu').onclick = () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.hidden = !sidebar.hidden;
  };
  document.querySelectorAll('#sidebar nav button[data-nav]').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('sidebar').hidden = true;
      navigate(btn.dataset.nav);
    };
  });
  document.getElementById('btnStore').onclick = saveDataToDrive;
  document.getElementById('btnRefresh').onclick = loadDataFromDrive;
  document.getElementById('btnUndo').onclick = undoAction;
  document.getElementById('btnSaveCSV').onclick = exportCSV;
  document.getElementById('btnConfirmRanking').onclick = confirmRanking;
}

window.onload = () => {
  bindUI();
  loadFromLocalStorage();
  renderSeats();
  navigate('scan');
  initCamera();

  pollTimer = setInterval(() => {
    if (!isSaving) loadDataFromDrive();
  }, POLL_INTERVAL_MS);
};
