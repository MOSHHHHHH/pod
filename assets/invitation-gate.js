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
    #invitation-gate { box-sizing: border-box; width: min(100%, 560px); margin: 10vh auto;
      padding: 28px; border: 1px solid #bed3eb; border-radius: 20px; background: #fff;
      color: #17324d; font: 17px/1.8 'Heebo', Arial, sans-serif; text-align: center; }
    #invitation-gate h1 { font-size: 25px; line-height: 1.5; margin: 0 0 18px; }
    #invitation-gate p { margin: 8px 0; }
    #invitation-gate label { display: block; margin-top: 20px; }
    #invitation-gate input { box-sizing: border-box; width: 100%; max-width: 240px;
      padding: 10px; border: 1px solid #bed3eb; border-radius: 9px;
      font: inherit; text-align: center; direction: ltr; }
    #invitation-gate button { display: block; margin: 12px auto 0; padding: 10px 28px;
      border: 0; border-radius: 9px; background: #1764c0; color: white;
      font: inherit; cursor: pointer; }
    #invitation-gate :focus-visible { outline: 3px solid #087d92; outline-offset: 3px; }
    #invitation-error { color: #b93b59; }
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
      <h1 id="invitation-title">ממשק ההרשמה פתוח בקבלת הזמנה בלבד</h1>
      <p>הקישור שקיבלת כבר לא תקף</p>
      <p>פנה למפתח לקבלת קוד עדכני</p>
      <form>
        <label for="invitation-code">קוד הזמנה</label>
        <input id="invitation-code" type="text" inputmode="numeric" autocomplete="off"
          pattern="[0-9]{1,4}" maxlength="4" required aria-describedby="invitation-error">
        <button type="submit">כניסה</button>
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
