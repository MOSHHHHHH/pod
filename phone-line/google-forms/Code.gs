const CALL_FIELDS = {
  id: 'מזהה שיחה',
  user_id: 'מזהה משתמש',
  started_at: 'מועד ההתחלה',
  duration_seconds: 'משך בשניות',
  model: 'מודל',
  reason: 'עילת סיום',
  topics: 'נושאים',
  classification_status: 'מצב סיווג',
};
const REVIEW_FIELDS = {
  id: CALL_FIELDS.id,
  user_id: CALL_FIELDS.user_id,
  started_at: CALL_FIELDS.started_at,
  model: CALL_FIELDS.model,
  rules: 'כללים שסומנו לבדיקה',
};

function setupPhoneForms() {
  ensureForm_('PHONE_CALL_FORM_ID', 'קו Gemini Live · שיחות', CALL_FIELDS);
  ensureForm_('PHONE_REVIEW_FORM_ID', 'קו Gemini Live · אירועי ניטור', REVIEW_FIELDS);
}

function ensureForm_(property, title, fields) {
  const properties = PropertiesService.getScriptProperties();
  let id = properties.getProperty(property);
  const form = id ? FormApp.openById(id) : FormApp.create(title);
  if (!id) properties.setProperty(property, form.getId());
  const existing = new Set(form.getItems().map(item => item.getTitle()));
  for (const name of Object.values(fields)) {
    if (!existing.has(name)) form.addTextItem().setTitle(name).setRequired(true);
  }
}

function doPost(event) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const key = properties.getProperty('PHONE_FORMS_KEY');
    const body = event.postData.contents;
    if (!key || body.length > 16384) return result_({ ok: false });
    const { payload, signature } = JSON.parse(body);
    if (typeof payload !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) {
      return result_({ ok: false });
    }
    const expected = Utilities.computeHmacSha256Signature(payload, key, Utilities.Charset.UTF_8)
      .map(value => (value & 255).toString(16).padStart(2, '0')).join('');
    let difference = 0;
    for (let i = 0; i < expected.length; i++) {
      difference |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (difference) return result_({ ok: false });
    const report = JSON.parse(payload);
    if (!/^[a-f0-9]{32}$/.test(report.id) || !/^[a-f0-9]{32}$/.test(report.user_id)
        || !Number.isFinite(Date.parse(report.started_at))
        || !Number.isFinite(report.duration_seconds) || report.duration_seconds < 0
        || typeof report.topics !== 'string' || typeof report.rules !== 'string') {
      return result_({ ok: false });
    }
    const rules = JSON.parse(report.rules);
    if (!Array.isArray(rules)) return result_({ ok: false });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      submitOnce_(properties.getProperty('PHONE_CALL_FORM_ID'), CALL_FIELDS, report);
      if (rules.length) {
        submitOnce_(properties.getProperty('PHONE_REVIEW_FORM_ID'), REVIEW_FIELDS, report);
      }
    } finally {
      lock.releaseLock();
    }
    return result_({ ok: true, id: report.id });
  } catch (_) {
    return result_({ ok: false });
  }
}

function submitOnce_(formId, fields, report) {
  const form = FormApp.openById(formId);
  const itemsByTitle = new Map(form.getItems().map(item => [item.getTitle(), item]));
  const idItem = itemsByTitle.get(fields.id);
  const from = new Date(Date.parse(report.started_at) - 86400000);
  for (const response of form.getResponses(from)) {
    const responseId = response.getResponseForItem(idItem);
    if (responseId && responseId.getResponse() === report.id) return;
  }
  let response = form.createResponse();
  for (const [key, title] of Object.entries(fields)) {
    const item = itemsByTitle.get(title).asTextItem();
    response = response.withItemResponse(item.createResponse(String(report[key])));
  }
  response.submit();
}

function result_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
