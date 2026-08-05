(() => {
  'use strict';

  // Индекс 0 = пусто/#ffffff, 1..32 = выбираемые цвета (порядок совпадает с сервером).
  const PALETTE = [
    '#ffffff',
    '#000000', '#3A3A3A', '#515252', '#808080', '#D4D7D9', '#FFFFFF',
    '#6D001A', '#BE0039', '#BE0075', '#FF4500', '#FFA800', '#FFD635', '#FFF8B8',
    '#00A368', '#00CC78', '#7EED56', '#00756F', '#009E9E', '#51E9F4',
    '#2450A4', '#3690EA', '#493FA5', '#6A5CFF', '#811E9F', '#B44AC0',
    '#FF99AA', '#FFD4E5', '#6D482F', '#9C6926', '#CC6E3B', '#FFB470', '#E4AB9F',
  ];
  const CANVAS_SIZE = 500;
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 40;
  const GRID_VISIBLE_SCALE = 8;

  const PALETTE_RGB = PALETTE.map((hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]);

  // ---------- DOM ----------
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');

  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const loginError = document.getElementById('login-error');
  const registerError = document.getElementById('register-error');
  const registerSubmit = document.getElementById('register-submit');
  const acceptTosCheckbox = document.getElementById('accept-tos');
  const acceptPrivacyCheckbox = document.getElementById('accept-privacy');
  const openTosBtn = document.getElementById('open-tos-btn');
  const openPrivacyBtn = document.getElementById('open-privacy-btn');
  const legalModal = document.getElementById('legal-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalClose = document.getElementById('modal-close');
  const modalOk = document.getElementById('modal-ok');

  const usernameLabel = document.getElementById('username-label');
  const userPill = document.getElementById('user-pill');
  const logoutBtn = document.getElementById('logout-btn');

  const canvasWrap = document.getElementById('canvas-wrap');
  const viewCanvas = document.getElementById('view-canvas');
  const viewCtx = viewCanvas.getContext('2d');
  const hoverCoords = document.getElementById('hover-coords');
  const toastEl = document.getElementById('toast');

  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const zoomFitBtn = document.getElementById('zoom-fit');
  const downloadBtn = document.getElementById('download-btn');

  const paletteEl = document.getElementById('palette');
  const currentColorEl = document.getElementById('current-color');
  const cooldownRing = document.getElementById('cooldown-ring');
  const cooldownText = document.getElementById('cooldown-text');
  const cooldownLabel = document.getElementById('cooldown-label');

  // Офскрин-холст: 1 пиксель канваса = 1 логический пиксель рисунка.
  const offCanvas = document.createElement('canvas');
  offCanvas.width = CANVAS_SIZE;
  offCanvas.height = CANVAS_SIZE;
  const offCtx = offCanvas.getContext('2d');

  // Локальное зеркало буфера холста (0..32), чтобы уметь откатывать
  // оптимистичную закраску, если сервер отклонит пиксель.
  let pixelBuffer = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);

  // ---------- Состояние ----------
  let currentUser = null; // { username, noCooldown }
  let cooldownUntil = 0;
  let cooldownTimer = null;
  let selectedColorIndex = 1;
  let ws = null;

  let scale = 1;
  let originX = 0;
  let originY = 0;

  // Пан мышью
  let dragging = false;
  let dragMoved = false;
  let dragStart = { x: 0, y: 0 };
  let dragOriginStart = { x: 0, y: 0 };

  // Пиксель под курсором (только мышь) — для подсветки наведения
  let hoverPixel = null;

  // Пинч-зум (тач)
  let pinchActive = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchStartMid = { x: 0, y: 0 };
  let pinchStartOrigin = { x: 0, y: 0 };

  let drawScheduled = false;

  // ---------- Утилиты ----------
  function showToast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function formatSeconds(ms) {
    const s = Math.ceil(ms / 1000);
    return `0:${String(s).padStart(2, '0')}`;
  }

  function scheduleDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => {
      drawScheduled = false;
      draw();
    });
  }

  // ---------- Переключение экранов ----------
  function showAuthScreen() {
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
  }

  function showAppScreen() {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
  }

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  });

  // ---------- Условия использования / Политика конфиденциальности ----------
  const TOS_HTML = `
    <h3>1. Общие положения</h3>
    <p>Pixel Battle — некоммерческий тестовый сервис коллективного пиксель-арта.
    Регистрируясь, вы соглашаетесь с настоящими условиями. Сервисом не следует
    пользоваться лицам младше 13 лет.</p>

    <h3>2. Аккаунт</h3>
    <ul>
      <li>Один человек — один аккаунт. Регистрация нескольких аккаунтов одним
      и тем же человеком (мультиаккаунтинг), в том числе для обхода кулдауна,
      запрещена.</li>
      <li>Вы несёте ответственность за сохранность своего пароля и за любые
      действия, совершённые под вашим аккаунтом.</li>
    </ul>

    <h3>3. Правила рисования</h3>
    <p>На холсте запрещено размещать:</p>
    <ul>
      <li>флаги любых государств, организаций, движений и сообществ;</li>
      <li>нацистскую, экстремистскую символику и любую связанную с ними
      пропаганду;</li>
      <li>откровенный (NSFW) контент сексуального характера — изображения в
      купальниках/белье без откровенных сцен допустимы, явный сексуальный
      контент — нет;</li>
      <li>нецензурную лексику, оскорбления и разжигание ненависти;</li>
      <li>любой иной контент, нарушающий общепринятые нормы приличия или
      законодательство.</li>
    </ul>

    <h3>4. Модерация</h3>
    <p>Администрация вправе удалить, закрасить или иным образом изменить
    любой контент (пиксели) на холсте по своему усмотрению, без
    предварительного уведомления и без объяснения причин. Администрация
    также вправе ограничить или заблокировать доступ аккаунту, нарушающему
    настоящие условия.</p>

    <h3>5. Ограничение ответственности</h3>
    <p>Сервис предоставляется «как есть», в тестовых целях, без каких-либо
    гарантий работоспособности или сохранности данных.</p>

    <h3>6. Изменения условий</h3>
    <p>Условия могут быть изменены в любой момент; актуальная версия всегда
    доступна в этом окне.</p>

    <h3>7. Контакты</h3>
    <p>По всем вопросам: <a href="https://t.me/oguricappu" target="_blank" rel="noopener noreferrer">t.me/oguricappu</a>.</p>
  `;

  const PRIVACY_HTML = `
    <h3>1. Какие данные собираются</h3>
    <ul>
      <li>никнейм;</li>
      <li>хеш пароля (сам пароль не хранится и не может быть восстановлен в
      исходном виде);</li>
      <li>сессионная cookie, необходимая для авторизации;</li>
      <li>пиксели, которые вы разместили (координаты, цвет, время, ваш
      никнейм) — эти данные публичны, так как холст общий и виден всем
      пользователям сервиса.</li>
    </ul>

    <h3>2. Как используются данные</h3>
    <p>Только для работы сервиса: авторизации, отображения холста и
    соблюдения кулдауна между размещением пикселей. Данные не передаются
    третьим лицам и не используются для рекламы или аналитики.</p>

    <h3>3. Хранение</h3>
    <p>Pixel Battle — локальный тестовый проект: данные хранятся на том
    сервере, где он запущен (файлы <code>data/users.json</code> и
    <code>data/canvas.bin</code>), и не отправляются во внешние сервисы.</p>

    <h3>4. Cookie</h3>
    <p>Используется только техническая cookie сессии для авторизации.
    Сторонние трекеры и рекламные cookie не используются.</p>

    <h3>5. Права пользователя</h3>
    <p>Вы можете запросить удаление своего аккаунта и связанных с ним
    данных, написав администратору: <a href="https://t.me/oguricappu" target="_blank" rel="noopener noreferrer">t.me/oguricappu</a>.</p>

    <h3>6. Изменения политики</h3>
    <p>Политика может обновляться; актуальная версия всегда доступна в этом
    окне.</p>
  `;

  function openLegalModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalBody.scrollTop = 0;
    legalModal.classList.remove('hidden');
  }

  function closeLegalModal() {
    legalModal.classList.add('hidden');
  }

  openTosBtn.addEventListener('click', () => openLegalModal('Условия использования', TOS_HTML));
  openPrivacyBtn.addEventListener('click', () => openLegalModal('Политика конфиденциальности', PRIVACY_HTML));
  modalClose.addEventListener('click', closeLegalModal);
  modalOk.addEventListener('click', closeLegalModal);
  legalModal.addEventListener('click', (e) => {
    if (e.target === legalModal) closeLegalModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !legalModal.classList.contains('hidden')) closeLegalModal();
  });

  function updateRegisterSubmitState() {
    registerSubmit.disabled = !(acceptTosCheckbox.checked && acceptPrivacyCheckbox.checked);
  }
  acceptTosCheckbox.addEventListener('change', updateRegisterSubmitState);
  acceptPrivacyCheckbox.addEventListener('change', updateRegisterSubmitState);

  // ---------- Авторизация ----------
  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Ошибка запроса');
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const data = await postJSON('/api/login', { username, password });
      await onAuthSuccess(data);
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerError.textContent = '';

    if (!acceptTosCheckbox.checked || !acceptPrivacyCheckbox.checked) {
      registerError.textContent = 'Нужно принять условия использования и политику конфиденциальности';
      return;
    }

    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    try {
      const data = await postJSON('/api/register', {
        username,
        password,
        acceptTos: acceptTosCheckbox.checked,
        acceptPrivacy: acceptPrivacyCheckbox.checked,
      });
      await onAuthSuccess(data);
    } catch (err) {
      registerError.textContent = err.message;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try { await postJSON('/api/logout'); } catch (e) { /* игнорируем */ }
    if (ws) { ws.close(); ws = null; }
    clearInterval(cooldownTimer);
    currentUser = null;
    loginForm.reset();
    registerForm.reset();
    updateRegisterSubmitState();
    showAuthScreen();
  });

  async function onAuthSuccess(data) {
    currentUser = { username: data.username, noCooldown: data.noCooldown };
    await enterApp(0);
  }

  // ---------- Вход в приложение ----------
  async function enterApp(cooldownRemaining) {
    usernameLabel.textContent = currentUser.username;
    userPill.classList.toggle('unlimited', currentUser.noCooldown);
    showAppScreen();

    buildPalette();
    resizeCanvasElement();
    fitView();

    await loadCanvas();
    connectWS();

    if (currentUser.noCooldown) {
      setUnlimitedCooldownUI();
    } else {
      startCooldown(cooldownRemaining || 0, true);
    }
  }

  async function loadCanvas() {
    const res = await fetch('/api/canvas');
    if (!res.ok) {
      showToast('Не удалось загрузить холст');
      return;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    renderFullCanvas(buf);
    draw();
  }

  function renderFullCanvas(buf) {
    pixelBuffer = new Uint8Array(buf); // копия — источник для отката
    const img = offCtx.createImageData(CANVAS_SIZE, CANVAS_SIZE);
    for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
      const idx = buf[i] || 0;
      const [r, g, b] = PALETTE_RGB[idx] || PALETTE_RGB[0];
      const p = i * 4;
      img.data[p] = r;
      img.data[p + 1] = g;
      img.data[p + 2] = b;
      img.data[p + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
  }

  function paintPixelLocal(x, y, colorIndex) {
    pixelBuffer[y * CANVAS_SIZE + x] = colorIndex;
    offCtx.fillStyle = PALETTE[colorIndex] || PALETTE[0];
    offCtx.fillRect(x, y, 1, 1);
  }

  // ---------- WebSocket ----------
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host + '/ws');
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'pixel') {
        paintPixelLocal(msg.x, msg.y, msg.colorIndex);
        draw();
      }
    };
    ws.onclose = () => {
      // Пробуем переподключиться, если мы всё ещё в приложении.
      if (currentUser) setTimeout(connectWS, 2000);
    };
  }

  // ---------- Палитра ----------
  function buildPalette() {
    paletteEl.innerHTML = '';
    for (let i = 1; i < PALETTE.length; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (i === selectedColorIndex ? ' selected' : '');
      btn.style.background = PALETTE[i];
      btn.title = PALETTE[i];
      btn.addEventListener('click', () => selectColor(i));
      paletteEl.appendChild(btn);
    }
    updateCurrentColorPreview();
  }

  function selectColor(index) {
    selectedColorIndex = index;
    [...paletteEl.children].forEach((el, i) => {
      el.classList.toggle('selected', i + 1 === index);
    });
    updateCurrentColorPreview();
  }

  function updateCurrentColorPreview() {
    currentColorEl.style.background = PALETTE[selectedColorIndex];
  }

  // ---------- Кулдаун ----------
  function setUnlimitedCooldownUI() {
    clearInterval(cooldownTimer);
    cooldownRing.classList.remove('waiting');
    cooldownText.textContent = '★';
    cooldownLabel.textContent = 'Без кулдауна';
  }

  function startCooldown(remainingMs, silent) {
    if (currentUser && currentUser.noCooldown) return;
    clearInterval(cooldownTimer);
    cooldownUntil = Date.now() + remainingMs;

    function tick() {
      const left = cooldownUntil - Date.now();
      if (left <= 0) {
        clearInterval(cooldownTimer);
        cooldownRing.classList.remove('waiting');
        cooldownText.textContent = '✓';
        cooldownLabel.textContent = 'Готов рисовать';
        return;
      }
      cooldownRing.classList.add('waiting');
      cooldownText.textContent = Math.ceil(left / 1000);
      cooldownLabel.textContent = 'Кулдаун: ' + formatSeconds(left);
    }

    tick();
    cooldownTimer = setInterval(tick, 250);
    if (!silent && remainingMs > 0) showToast('Пиксель поставлен. Кулдаун 1 минута.');
  }

  function isReadyToPaint() {
    if (currentUser.noCooldown) return true;
    return Date.now() >= cooldownUntil;
  }

  // ---------- Рендер / трансформация ----------
  function resizeCanvasElement() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvasWrap.getBoundingClientRect();
    viewCanvas.style.width = rect.width + 'px';
    viewCanvas.style.height = rect.height + 'px';
    viewCanvas.width = Math.round(rect.width * dpr);
    viewCanvas.height = Math.round(rect.height * dpr);
    viewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function fitView() {
    const rect = canvasWrap.getBoundingClientRect();
    const margin = 40;
    const s = Math.min(
      (rect.width - margin) / CANVAS_SIZE,
      (rect.height - margin) / CANVAS_SIZE
    );
    scale = clamp(s, MIN_SCALE, MAX_SCALE);
    originX = (rect.width - CANVAS_SIZE * scale) / 2;
    originY = (rect.height - CANVAS_SIZE * scale) / 2;
    draw();
  }

  function draw() {
    const rect = canvasWrap.getBoundingClientRect();
    viewCtx.imageSmoothingEnabled = false;
    viewCtx.clearRect(0, 0, rect.width, rect.height);

    viewCtx.save();
    viewCtx.translate(originX, originY);
    viewCtx.scale(scale, scale);
    viewCtx.drawImage(offCanvas, 0, 0);
    viewCtx.restore();

    if (scale >= GRID_VISIBLE_SCALE) {
      drawGrid(rect);
    }
    drawCanvasBorder();
    drawHoverHighlight();
  }

  // Тонкая рамка по границе полотна — видна независимо от того, какого цвета
  // пиксели стоят по краю (в т.ч. чёрные) и какого цвета фон вокруг.
  function drawCanvasBorder() {
    const x0 = Math.round(originX) + 0.5;
    const y0 = Math.round(originY) + 0.5;
    const w = Math.round(CANVAS_SIZE * scale) - 1;
    const h = Math.round(CANVAS_SIZE * scale) - 1;
    viewCtx.save();
    viewCtx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    viewCtx.lineWidth = 1;
    viewCtx.strokeRect(x0, y0, w, h);
    viewCtx.restore();
  }

  function drawGrid(rect) {
    viewCtx.save();
    viewCtx.strokeStyle = 'rgba(255,255,255,0.06)';
    viewCtx.lineWidth = 1;
    const startX = Math.max(0, Math.floor(-originX / scale));
    const endX = Math.min(CANVAS_SIZE, Math.ceil((rect.width - originX) / scale));
    const startY = Math.max(0, Math.floor(-originY / scale));
    const endY = Math.min(CANVAS_SIZE, Math.ceil((rect.height - originY) / scale));

    viewCtx.beginPath();
    for (let gx = startX; gx <= endX; gx++) {
      const sx = Math.round(originX + gx * scale) + 0.5;
      viewCtx.moveTo(sx, Math.max(0, originY));
      viewCtx.lineTo(sx, Math.min(rect.height, originY + CANVAS_SIZE * scale));
    }
    for (let gy = startY; gy <= endY; gy++) {
      const sy = Math.round(originY + gy * scale) + 0.5;
      viewCtx.moveTo(Math.max(0, originX), sy);
      viewCtx.lineTo(Math.min(rect.width, originX + CANVAS_SIZE * scale), sy);
    }
    viewCtx.stroke();
    viewCtx.restore();
  }

  // Серая подсветка пикселя под курсором — чтобы не промахиваться.
  function drawHoverHighlight() {
    if (!hoverPixel || dragging) return;
    const sx = originX + hoverPixel.x * scale;
    const sy = originY + hoverPixel.y * scale;

    viewCtx.save();
    viewCtx.fillStyle = 'rgba(150, 156, 166, 0.55)';
    viewCtx.fillRect(sx, sy, scale, scale);
    viewCtx.strokeStyle = 'rgba(231, 233, 236, 0.85)';
    viewCtx.lineWidth = scale >= GRID_VISIBLE_SCALE ? 1 : Math.max(1, Math.min(2, scale * 0.06));
    viewCtx.strokeRect(sx + 0.5, sy + 0.5, Math.max(0, scale - 1), Math.max(0, scale - 1));
    viewCtx.restore();
  }

  function screenToLogical(clientX, clientY) {
    const rect = canvasWrap.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const lx = Math.floor((sx - originX) / scale);
    const ly = Math.floor((sy - originY) / scale);
    return { lx, ly, sx, sy };
  }

  function inRange(lx, ly) {
    return lx >= 0 && ly >= 0 && lx < CANVAS_SIZE && ly < CANVAS_SIZE;
  }

  function updateHoverFromClient(clientX, clientY) {
    const { lx, ly } = screenToLogical(clientX, clientY);
    if (inRange(lx, ly)) {
      hoverCoords.textContent = `X: ${lx} Y: ${ly}`;
      hoverPixel = { x: lx, y: ly };
    } else {
      hoverCoords.textContent = 'X: — Y: —';
      hoverPixel = null;
    }
  }

  // ---------- Взаимодействие мышью: пан / зум / клик ----------
  canvasWrap.addEventListener('contextmenu', (e) => e.preventDefault());

  canvasWrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dragMoved = false;
    dragStart = { x: e.clientX, y: e.clientY };
    dragOriginStart = { x: originX, y: originY };
    canvasWrap.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (dragging) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
      originX = dragOriginStart.x + dx;
      originY = dragOriginStart.y + dy;
      hoverPixel = null;
      scheduleDraw();
      return;
    }
    updateHoverFromClient(e.clientX, e.clientY);
    scheduleDraw();
  });

  window.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    canvasWrap.classList.remove('dragging');
    if (!dragMoved) {
      handlePixelClick(e.clientX, e.clientY);
    }
    updateHoverFromClient(e.clientX, e.clientY);
    scheduleDraw();
  });

  canvasWrap.addEventListener('mouseleave', () => {
    if (!dragging) {
      hoverPixel = null;
      hoverCoords.textContent = 'X: — Y: —';
      scheduleDraw();
    }
  });

  canvasWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvasWrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoomAround(mx, my, factor);
    updateHoverFromClient(e.clientX, e.clientY);
    scheduleDraw();
  }, { passive: false });

  zoomInBtn.addEventListener('click', () => zoomAtCenter(1.3));
  zoomOutBtn.addEventListener('click', () => zoomAtCenter(1 / 1.3));
  zoomFitBtn.addEventListener('click', fitView);
  downloadBtn.addEventListener('click', downloadCanvasImage);

  function zoomAround(px, py, factor) {
    const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
    const lx = (px - originX) / scale;
    const ly = (py - originY) / scale;
    originX = px - lx * newScale;
    originY = py - ly * newScale;
    scale = newScale;
  }

  function zoomAtCenter(factor) {
    const rect = canvasWrap.getBoundingClientRect();
    zoomAround(rect.width / 2, rect.height / 2, factor);
    draw();
  }

  // ---------- Взаимодействие тачем: пан / пинч-зум / тап ----------
  function touchDistance(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  function touchMidpoint(t1, t2, rect) {
    return {
      x: (t1.clientX + t2.clientX) / 2 - rect.left,
      y: (t1.clientY + t2.clientY) / 2 - rect.top,
    };
  }

  canvasWrap.addEventListener('touchstart', (e) => {
    e.preventDefault();
    hoverPixel = null;

    if (e.touches.length === 1 && !pinchActive) {
      const t = e.touches[0];
      dragging = true;
      dragMoved = false;
      dragStart = { x: t.clientX, y: t.clientY };
      dragOriginStart = { x: originX, y: originY };
    } else if (e.touches.length >= 2) {
      dragging = false;
      pinchActive = true;
      const [t1, t2] = e.touches;
      const rect = canvasWrap.getBoundingClientRect();
      pinchStartDist = touchDistance(t1, t2) || 1;
      pinchStartScale = scale;
      pinchStartMid = touchMidpoint(t1, t2, rect);
      pinchStartOrigin = { x: originX, y: originY };
    }
  }, { passive: false });

  canvasWrap.addEventListener('touchmove', (e) => {
    e.preventDefault();

    if (e.touches.length >= 2) {
      const [t1, t2] = e.touches;
      const rect = canvasWrap.getBoundingClientRect();
      const dist = touchDistance(t1, t2) || 1;
      const mid = touchMidpoint(t1, t2, rect);
      const newScale = clamp(pinchStartScale * (dist / pinchStartDist), MIN_SCALE, MAX_SCALE);

      const lx = (pinchStartMid.x - pinchStartOrigin.x) / pinchStartScale;
      const ly = (pinchStartMid.y - pinchStartOrigin.y) / pinchStartScale;
      originX = mid.x - lx * newScale;
      originY = mid.y - ly * newScale;
      scale = newScale;
      scheduleDraw();
    } else if (e.touches.length === 1 && dragging) {
      const t = e.touches[0];
      const dx = t.clientX - dragStart.x;
      const dy = t.clientY - dragStart.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) dragMoved = true;
      originX = dragOriginStart.x + dx;
      originY = dragOriginStart.y + dy;
      scheduleDraw();
    }
  }, { passive: false });

  canvasWrap.addEventListener('touchend', (e) => {
    e.preventDefault();

    if (e.touches.length === 0) {
      if (pinchActive) {
        pinchActive = false;
      } else if (dragging && !dragMoved) {
        const ct = e.changedTouches[0];
        handlePixelClick(ct.clientX, ct.clientY);
      }
      dragging = false;
    } else if (e.touches.length === 1) {
      // Отпустили один из двух пальцев — переходим обратно в режим пана.
      pinchActive = false;
      const t = e.touches[0];
      dragging = true;
      dragMoved = false;
      dragStart = { x: t.clientX, y: t.clientY };
      dragOriginStart = { x: originX, y: originY };
    }
    scheduleDraw();
  }, { passive: false });

  canvasWrap.addEventListener('touchcancel', () => {
    dragging = false;
    pinchActive = false;
    hoverPixel = null;
    scheduleDraw();
  }, { passive: false });

  // ---------- Размещение пикселя ----------
  async function handlePixelClick(clientX, clientY) {
    const { lx, ly } = screenToLogical(clientX, clientY);
    if (!inRange(lx, ly)) return;

    if (!isReadyToPaint()) {
      showToast('Подождите окончания кулдауна');
      return;
    }

    // Оптимистичная отрисовка — сервер подтвердит через ответ/WS.
    const previousColor = pixelBuffer[ly * CANVAS_SIZE + lx];
    paintPixelLocal(lx, ly, selectedColorIndex);
    draw();

    try {
      const res = await fetch('/api/pixel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: lx, y: ly, colorIndex: selectedColorIndex }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Откатываем оптимистичную закраску, раз сервер её не принял.
        paintPixelLocal(lx, ly, previousColor);
        draw();
        showToast(data.error || 'Не удалось поставить пиксель');
        if (typeof data.cooldownRemaining === 'number') {
          startCooldown(data.cooldownRemaining, true);
        }
        return;
      }
      if (!currentUser.noCooldown) {
        startCooldown(data.cooldownRemaining, false);
      }
    } catch (err) {
      paintPixelLocal(lx, ly, previousColor);
      draw();
      showToast('Ошибка сети');
    }
  }

  // ---------- Скачать карту как PNG ----------
  function downloadCanvasImage() {
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `pixel-battle-${stamp}.png`;
    link.href = offCanvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Карта сохранена как PNG');
  }

  window.addEventListener('resize', () => {
    resizeCanvasElement();
    draw();
  });

  // ---------- Стартовая проверка сессии ----------
  async function checkSession() {
    try {
      const res = await fetch('/api/me');
      const data = await res.json();
      if (data.user) {
        currentUser = data.user;
        await enterApp(data.cooldownRemaining || 0);
      } else {
        showAuthScreen();
      }
    } catch (err) {
      showAuthScreen();
    }
  }

  checkSession();
})();
