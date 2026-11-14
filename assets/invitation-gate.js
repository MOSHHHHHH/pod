(function () {
  'use strict';

  const root = document.documentElement;
  const storageKey = 'pod-invitation';
  const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  let acceptedDay = null;
  let gate;
  let input;
  let error;
  let timer;

  root.setAttribute('data-invitation-locked', '');
  const style = document.createElement('style');
  style.textContent = `
    html[data-invitation-locked] body > :not(#invitation-gate) { display: none !important; }
    #invitation-gate[hidden] { display: none !important; }
    html[data-invitation-locked] body { min-height: 100vh; min-height: 100svh;
      align-items: center; padding: 28px 20px; }
    #invitation-gate { position: relative; box-sizing: border-box; width: min(100%, 480px);
      margin: auto; padding: 36px 40px 24px; overflow: hidden;
      border: 1px solid #dce8f5; border-radius: 28px; background: #fff;
      box-shadow: 0 24px 70px -28px #17324d35, 0 4px 18px #17324d06;
      color: #17324d; font: 16px/1.75 'Heebo', Arial, sans-serif; text-align: center; }
    #invitation-gate::before { content: ''; position: absolute; inset: 0 0 auto;
      height: 4px; background: linear-gradient(90deg, #1764c0, #29a2b6); }
    #invitation-gate .invitation-brand { margin: 0 0 24px; color: #4c6680;
      font-size: 14px; font-weight: 600; }
    #invitation-gate .invitation-icon { display: grid; place-items: center;
      width: 68px; height: 68px; margin: 0 auto 22px; border: 1px solid #dce8f5;
      border-radius: 22px; background: linear-gradient(145deg, #f3f8ff, #e6f2fb);
      color: #1764c0; }
    #invitation-gate h1 { max-width: 340px; margin: 0 auto 18px;
      font-size: clamp(24px, 5vw, 29px); font-weight: 750; line-height: 1.45;
      letter-spacing: -.5px; text-wrap: balance; }
    #invitation-gate .invitation-message { padding: 14px 16px; border: 1px solid #e4edf6;
      border-radius: 14px; background: #f7faff; color: #4c6680; font-size: 14px; }
    #invitation-gate p { margin: 0; }
    #invitation-gate .invitation-message p + p { margin-top: 2px; }
    #invitation-gate form { margin-top: 26px; }
    #invitation-gate label { display: block; margin-bottom: 9px;
      text-align: start; font-size: 14px; font-weight: 600; }
    #invitation-gate input { box-sizing: border-box; display: block; width: 100%;
      height: 62px; padding: 8px 14px; border: 1.5px solid #bed3eb; border-radius: 12px;
      background: #fcfdff; color: #17324d; font: 600 28px/1.3 'Heebo', Arial, sans-serif;
      text-align: center; direction: ltr; letter-spacing: .28em; text-indent: .28em;
      transition: border-color .18s, box-shadow .18s; }
    #invitation-gate input::placeholder { color: #a4b8cc; opacity: 1; }
    #invitation-gate input:focus { border-color: #1764c0; background: #fff;
      box-shadow: 0 0 0 4px #1764c012; }
    #invitation-gate button { display: flex; align-items: center; justify-content: center;
      gap: 10px; width: 100%; min-height: 52px; margin: 14px 0 0; padding: 12px 22px;
      border: 1px solid #145ab0; border-radius: 12px;
      background: linear-gradient(180deg, #2070cc, #1764c0); color: white;
      box-shadow: 0 5px 12px #1764c01c; font: 600 16px/1.5 'Heebo', Arial, sans-serif;
      cursor: pointer; transition: background .18s, box-shadow .18s, transform .18s; }
    #invitation-gate button:hover { background: #1458aa; box-shadow: 0 6px 18px #1764c02b; }
    #invitation-gate button:active { transform: translateY(1px); }
    #invitation-gate :focus-visible { outline: 3px solid #087d92; outline-offset: 3px; }
    #invitation-gate #invitation-error { min-height: 25px; margin-top: 10px;
      color: #b93b59; font-size: 14px; }
    @media (max-width: 480px) {
      #invitation-gate { padding: 28px 24px 18px; border-radius: 22px; }
      #invitation-gate .invitation-brand { margin-bottom: 20px; }
    }
    @media (prefers-reduced-motion: reduce) {
      #invitation-gate input, #invitation-gate button { transition: none; }
    }
  `;
  document.head.appendChild(style);

  function israelDate() {
    const now = new Date();
    const parts = Object.fromEntries(dateFormatter.formatToParts(now).map(p => [p.type, p.value]));
    return {
      day: parts.year + '-' + parts.month + '-' + parts.day,
      code: (Number(parts.day + parts.month) * 613) % 10000,
      // Recalculate at least once a minute to account for clock and DST changes.
      delay: Math.min(60000, ((24 - Number(parts.hour)) * 3600 -
        Number(parts.minute) * 60 - Number(parts.second)) * 1000 - now.getMilliseconds())
    };
  }

  function validCode(value, date) {
    return typeof value === 'string' && /^\d{1,4}$/.test(value.trim()) &&
      Number(value.trim()) === date.code;
  }

  function remember(date) {
    acceptedDay = date.day;
    try { sessionStorage.setItem(storageKey, date.day); } catch (_) { /* Storage is optional. */ }
  }

  function refresh() {
    const date = israelDate();
    const unlocked = acceptedDay === date.day;
    root.toggleAttribute('data-invitation-locked', !unlocked);
    if (gate) gate.hidden = unlocked;
    if (!unlocked && acceptedDay !== null) {
      acceptedDay = null;
      try { sessionStorage.removeItem(storageKey); } catch (_) { /* Storage is optional. */ }
      if (input) input.value = '';
      if (error) error.textContent = '';
    }
    clearTimeout(timer);
    timer = setTimeout(refresh, Math.max(1, date.delay));
  }

  const initialDate = israelDate();
  const urlCode = new URLSearchParams(window.location.search).get('code');
  if (urlCode !== null) {
    if (validCode(urlCode, initialDate)) remember(initialDate);
    else {
      try { sessionStorage.removeItem(storageKey); } catch (_) { /* Storage is optional. */ }
    }
  } else {
    try {
      if (sessionStorage.getItem(storageKey) === initialDate.day) acceptedDay = initialDate.day;
    } catch (_) { /* Storage is optional. */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    gate = document.createElement('section');
    gate.id = 'invitation-gate';
    gate.dir = 'rtl';
    gate.setAttribute('aria-labelledby', 'invitation-title');
    gate.innerHTML = `
      <p class="invitation-brand">פודקי</p>
      <div class="invitation-icon" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="10" width="14" height="11" rx="3"></rect>
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"></path>
        </svg>
      </div>
      <h1 id="invitation-title">ממשק ההרשמה פתוח בקבלת הזמנה בלבד</h1>
      <div class="invitation-message">
        <p>הקישור שקיבלת כבר לא תקף</p>
        <p>פנה למפתח לקבלת קוד עדכני</p>
      </div>
      <form>
        <label for="invitation-code">קוד הזמנה</label>
        <input id="invitation-code" type="text" inputmode="numeric" autocomplete="off"
          pattern="[0-9]{1,4}" maxlength="4" placeholder="····" required aria-describedby="invitation-error">
        <button type="submit">כניסה
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 12H5m6-6-6 6 6 6"></path>
          </svg>
        </button>
        <p id="invitation-error" role="status" aria-live="polite"></p>
      </form>
    `;
    input = gate.querySelector('input');
    error = gate.querySelector('#invitation-error');
    gate.querySelector('form').addEventListener('submit', function (event) {
      event.preventDefault();
      const date = israelDate();
      if (validCode(input.value, date)) {
        remember(date);
        // Replace an expired URL code so a reload keeps the newly entered code.
        if (urlCode !== null) {
          const url = new URL(window.location.href);
          url.searchParams.set('code', String(date.code).padStart(4, '0'));
          history.replaceState(history.state, '', url);
        }
        refresh();
      } else {
        error.textContent = 'הקוד שהוזן אינו תקף';
        input.focus();
      }
    });
    document.body.appendChild(gate);
    refresh();
  });
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  refresh();
}());
