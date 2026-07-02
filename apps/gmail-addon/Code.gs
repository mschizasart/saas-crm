/**
 * AppoinlyCRM — Gmail add-on (Google Workspace Add-on, Apps Script V8 + CardService).
 *
 * Thin client that mirrors the Outlook add-in taskpane
 * (apps/web/app/addin/outlook/taskpane/page.tsx). It reads the open message's
 * sender, shows CRM context, and lets the user log the email or create a lead.
 * All logic hits the ALREADY-DEPLOYED backend REST API — no backend changes.
 *
 * Auth model (v1): the user signs in INSIDE the add-on with their CRM
 * email + password (POST /auth/login). We stash the JWT in
 * PropertiesService.getUserProperties() (per-user, per-script). We NEVER store
 * the password. On 401 we try /auth/refresh once, then fall back to the login
 * card. Google SSO / OAuth-to-CRM is a future enhancement.
 */

// ── Config ──
var API_BASE = 'https://www.appoinlycrm.net/api/v1';
var APP_BASE = 'https://www.appoinlycrm.net';

var PROP_ACCESS = 'crm_access';
var PROP_REFRESH = 'crm_refresh';

// ===========================================================================
// Entry points (referenced from appsscript.json triggers)
// ===========================================================================

/**
 * Homepage trigger — shown when the add-on is opened without a message context.
 */
function onHomepage(e) {
  if (!getAccessToken()) {
    return buildLoginCard(null, null, null);
  }
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('AppoinlyCRM')
        .setSubtitle('Open an email to see CRM context')
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(
          'You are signed in. Open any email and click the AppoinlyCRM icon ' +
            'to look up the sender, log the email, or create a lead.'
        )
      )
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextButton()
          .setText('Sign out')
          .setOnClickAction(
            CardService.newAction().setFunctionName('doLogout')
          )
      )
    )
    .build();
  return card;
}

/**
 * Contextual trigger — fired when a Gmail message is open.
 */
function onGmailMessage(e) {
  // Grant this execution access to the current message's metadata.
  setMessageAccessToken(e);

  var meta = readMessage(e);
  var sender = meta.senderEmail;
  var senderName = meta.senderName;
  var subject = meta.subject;
  var messageId = meta.messageId;

  if (!getAccessToken()) {
    return buildLoginCard(sender, senderName, messageId);
  }

  if (!sender) {
    return buildInfoCard('No sender found on this message.');
  }

  var ctx = fetchContext(sender, subject, messageId);
  if (ctx.unauthorized) {
    clearTokens();
    return buildLoginCard(sender, senderName, messageId);
  }
  if (ctx.error) {
    return buildInfoCard('Could not load CRM context: ' + ctx.error);
  }

  return buildContextCard(ctx.data, sender, senderName, subject, messageId);
}

// ===========================================================================
// Message reading
// ===========================================================================

/**
 * Grant the current execution temporary access to the open message so
 * GmailApp.getMessageById can read its metadata.
 */
function setMessageAccessToken(e) {
  try {
    if (e && e.gmail && e.gmail.accessToken) {
      GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
    }
  } catch (err) {
    // Non-fatal: readMessage will just return blanks.
  }
}

/**
 * Read sender email/name + subject from the open Gmail message.
 * Returns { senderEmail, senderName, subject, messageId }.
 */
function readMessage(e) {
  var out = { senderEmail: '', senderName: '', subject: '', messageId: '' };
  try {
    var messageId = e && e.gmail ? e.gmail.messageId : null;
    if (!messageId) return out;
    out.messageId = messageId;
    var msg = GmailApp.getMessageById(messageId);
    if (!msg) return out;
    var from = msg.getFrom() || '';
    var parsed = parseFrom(from);
    out.senderEmail = parsed.email;
    out.senderName = parsed.name;
    out.subject = msg.getSubject() || '';
  } catch (err) {
    // Leave blanks; caller shows an appropriate message.
  }
  return out;
}

/**
 * Parse a From header. Handles:
 *   "Jane Doe" <jane@x.com>
 *   Jane Doe <jane@x.com>
 *   jane@x.com
 *   <jane@x.com>
 * Returns { name, email }.
 */
function parseFrom(from) {
  var result = { name: '', email: '' };
  if (!from) return result;
  var s = String(from).trim();

  var angle = s.match(/<([^>]+)>/);
  if (angle) {
    result.email = angle[1].trim();
    var name = s.slice(0, angle.index).trim();
    // Strip surrounding quotes.
    name = name.replace(/^"(.*)"$/, '$1').trim();
    result.name = name;
    return result;
  }

  // No angle brackets — treat the whole thing as an address if it looks like one.
  var emailMatch = s.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  if (emailMatch) {
    result.email = emailMatch[0].trim();
  }
  return result;
}

// ===========================================================================
// Cards
// ===========================================================================

/**
 * Login card: email + password inputs and a Sign in button.
 * Sender/name/messageId are carried through so we can rebuild the context
 * card in place after a successful login.
 */
function buildLoginCard(senderEmail, senderName, messageId) {
  var section = CardService.newCardSection();

  section.addWidget(
    CardService.newTextParagraph().setText(
      'Sign in to your CRM account to see contact context for this email.'
    )
  );

  section.addWidget(
    CardService.newTextInput()
      .setFieldName('email')
      .setTitle('Email')
      .setHint('you@company.com')
  );

  section.addWidget(
    CardService.newTextInput()
      .setFieldName('password')
      .setTitle('Password')
      // CardService has no dedicated password type; mask is not available.
      // The value is only used transiently to obtain a JWT and never stored.
      .setHint('Your CRM password')
  );

  var loginAction = CardService.newAction()
    .setFunctionName('doLogin')
    .setParameters({
      senderEmail: senderEmail || '',
      senderName: senderName || '',
      messageId: messageId || ''
    });

  section.addWidget(
    CardService.newTextButton()
      .setText('Sign in')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setOnClickAction(loginAction)
  );

  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('AppoinlyCRM')
        .setSubtitle('Sign in')
    )
    .addSection(section)
    .build();
}

/**
 * Simple informational card.
 */
function buildInfoCard(text) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('AppoinlyCRM'))
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(text)
      )
    )
    .build();
}

/**
 * Context card.
 * ctx: parsed /addin/context response.
 */
function buildContextCard(ctx, senderEmail, senderName, subject, messageId) {
  ctx = ctx || {};
  var builder = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader()
      .setTitle('AppoinlyCRM')
      .setSubtitle(senderName ? senderName + ' · ' + senderEmail : senderEmail)
  );

  // Sender summary.
  var senderSection = CardService.newCardSection();
  senderSection.addWidget(
    CardService.newKeyValue()
      .setTopLabel('Email sender')
      .setContent(senderName || senderEmail)
      .setBottomLabel(senderName ? senderEmail : '')
  );
  if (subject) {
    senderSection.addWidget(
      CardService.newKeyValue().setTopLabel('Subject').setContent(subject)
    );
  }
  builder.addSection(senderSection);

  if (ctx.found) {
    var record = ctx.record || {};
    var relatedToId = ctx.relatedToId || record.id || ctx.contactId || '';
    var relatedToType = ctx.type || '';

    // Matched record.
    var recSection = CardService.newCardSection().setHeader('CRM record');
    recSection.addWidget(
      CardService.newKeyValue()
        .setTopLabel((relatedToType || 'record').toUpperCase())
        .setContent(record.name || senderName || senderEmail)
        .setBottomLabel(record.company || '')
    );
    if (record.email) {
      recSection.addWidget(
        CardService.newKeyValue().setTopLabel('Email').setContent(record.email)
      );
    }
    if (record.phone) {
      recSection.addWidget(
        CardService.newKeyValue().setTopLabel('Phone').setContent(record.phone)
      );
    }
    builder.addSection(recSection);

    // Recent activity.
    var activity = ctx.recentActivity || [];
    if (activity.length > 0) {
      var actSection = CardService.newCardSection().setHeader('Recent activity');
      for (var i = 0; i < Math.min(activity.length, 5); i++) {
        var a = activity[i] || {};
        actSection.addWidget(
          CardService.newKeyValue()
            .setTopLabel((a.type || '') + ' · ' + fmtDate(a.occurredAt))
            .setContent(a.subject || a.type || '(activity)')
            .setBottomLabel(a.direction || '')
        );
      }
      builder.addSection(actSection);
    }

    // Actions.
    var actionSection = CardService.newCardSection();
    var logAction = CardService.newAction()
      .setFunctionName('logEmail')
      .setParameters({
        relatedToType: relatedToType,
        relatedToId: relatedToId,
        senderEmail: senderEmail || '',
        senderName: senderName || '',
        subject: subject || '',
        messageId: messageId || ''
      });
    actionSection.addWidget(
      CardService.newTextButton()
        .setText('Log this email')
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(logAction)
    );

    var url = recordUrl(relatedToType, relatedToId);
    if (url) {
      actionSection.addWidget(
        CardService.newTextButton()
          .setText('Open in CRM')
          .setOpenLink(CardService.newOpenLink().setUrl(url))
      );
    }
    builder.addSection(actionSection);
  } else {
    // No match — create-lead form (prefilled from sender).
    var leadSection = CardService.newCardSection().setHeader('No contact found');
    leadSection.addWidget(
      CardService.newTextParagraph().setText('Create a lead from this sender.')
    );
    leadSection.addWidget(
      CardService.newTextInput()
        .setFieldName('name')
        .setTitle('Name')
        .setValue(senderName || '')
    );
    leadSection.addWidget(
      CardService.newTextInput()
        .setFieldName('email')
        .setTitle('Email')
        .setValue(senderEmail || '')
    );
    leadSection.addWidget(
      CardService.newTextInput().setFieldName('phone').setTitle('Phone')
    );
    leadSection.addWidget(
      CardService.newTextInput().setFieldName('company').setTitle('Company')
    );

    var createAction = CardService.newAction()
      .setFunctionName('createLead')
      .setParameters({
        senderEmail: senderEmail || '',
        senderName: senderName || '',
        subject: subject || '',
        messageId: messageId || ''
      });
    leadSection.addWidget(
      CardService.newTextButton()
        .setText('Create lead from sender')
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(createAction)
    );
    builder.addSection(leadSection);
  }

  return builder.build();
}

// ===========================================================================
// Actions
// ===========================================================================

/**
 * Sign in with CRM email + password → store JWT → rebuild context card.
 */
function doLogin(e) {
  var inputs = (e && e.formInput) || {};
  var params = (e && e.parameters) || {};
  var email = (inputs.email || '').trim();
  var password = inputs.password || '';

  if (!email || !password) {
    return notify('Enter your email and password.');
  }

  var res = apiFetch('/auth/login', 'post', {
    email: email,
    password: password
  });

  var body = res.body || {};
  if (res.status < 200 || res.status >= 300 || body.success === false || !body.accessToken) {
    var msg = body.message || 'Invalid email or password';
    if (Array.isArray(msg)) msg = msg.join(', ');
    return notify(msg);
  }

  var props = PropertiesService.getUserProperties();
  props.setProperty(PROP_ACCESS, body.accessToken);
  if (body.refreshToken) {
    props.setProperty(PROP_REFRESH, body.refreshToken);
  }

  // Rebuild the context card in place using the carried-through message info.
  var senderEmail = params.senderEmail || '';
  var senderName = params.senderName || '';
  var messageId = params.messageId || '';

  var card;
  if (senderEmail) {
    var ctx = fetchContext(senderEmail, '', messageId);
    if (ctx.unauthorized) {
      clearTokens();
      card = buildLoginCard(senderEmail, senderName, messageId);
    } else if (ctx.error) {
      card = buildInfoCard('Signed in, but could not load context: ' + ctx.error);
    } else {
      card = buildContextCard(ctx.data, senderEmail, senderName, '', messageId);
    }
  } else {
    card = onHomepage(e);
  }

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Signed in.'))
    .setNavigation(CardService.newNavigation().updateCard(card))
    .build();
}

/**
 * Sign out — clear stored tokens and show the login card.
 */
function doLogout(e) {
  clearTokens();
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Signed out.'))
    .setNavigation(
      CardService.newNavigation().updateCard(buildLoginCard(null, null, null))
    )
    .build();
}

/**
 * Log the open email to the CRM timeline.
 */
function logEmail(e) {
  var p = (e && e.parameters) || {};
  var senderName = p.senderName || p.senderEmail || 'sender';

  var payload = {
    relatedToType: p.relatedToType || undefined,
    relatedToId: p.relatedToId || undefined,
    senderEmail: p.senderEmail || undefined,
    subject: p.subject || '(no subject)',
    body: 'Email from ' + senderName + ' logged from Gmail add-on.',
    direction: 'inbound',
    occurredAt: new Date().toISOString()
  };

  var res = withAuthRetry('/addin/log-email', 'post', payload);
  if (res.unauthorized) {
    clearTokens();
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Session expired — please sign in.')
      )
      .setNavigation(
        CardService.newNavigation().updateCard(
          buildLoginCard(p.senderEmail, p.senderName, p.messageId)
        )
      )
      .build();
  }
  if (res.status < 200 || res.status >= 300) {
    return notify('Failed to log email (' + res.status + ').');
  }

  // Refresh the card so the newly logged activity shows.
  var card;
  if (p.senderEmail) {
    var ctx = fetchContext(p.senderEmail, p.subject, p.messageId);
    card = ctx.error
      ? buildInfoCard('Email logged. Context refresh failed: ' + ctx.error)
      : buildContextCard(ctx.data, p.senderEmail, p.senderName, p.subject, p.messageId);
  } else {
    card = buildInfoCard('Email logged to CRM.');
  }

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Email logged to CRM.'))
    .setNavigation(CardService.newNavigation().updateCard(card))
    .build();
}

/**
 * Create a lead from the sender.
 */
function createLead(e) {
  var inputs = (e && e.formInput) || {};
  var p = (e && e.parameters) || {};

  var name = (inputs.name || '').trim();
  if (!name) {
    return notify('A name is required to create a lead.');
  }

  var payload = {
    name: name,
    email: (inputs.email || '').trim() || undefined,
    phone: (inputs.phone || '').trim() || undefined,
    company: (inputs.company || '').trim() || undefined
  };

  var res = withAuthRetry('/addin/create-lead', 'post', payload);
  if (res.unauthorized) {
    clearTokens();
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Session expired — please sign in.')
      )
      .setNavigation(
        CardService.newNavigation().updateCard(
          buildLoginCard(p.senderEmail, p.senderName, p.messageId)
        )
      )
      .build();
  }

  var body = res.body || {};
  if (res.status < 200 || res.status >= 300) {
    var msg = body.message || ('Failed to create lead (' + res.status + ')');
    if (Array.isArray(msg)) msg = msg.join(', ');
    return notify(msg);
  }

  var leadId = body.id || '';
  var leadName = body.name || name;

  // Rebuild as a "found" context so the user can now log the email too.
  var ctx = {
    found: true,
    type: 'lead',
    relatedToId: leadId,
    record: {
      id: leadId,
      name: leadName,
      email: payload.email,
      phone: payload.phone,
      company: payload.company
    },
    recentActivity: []
  };
  var card = buildContextCard(ctx, p.senderEmail, p.senderName, p.subject, p.messageId);

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Lead created.'))
    .setNavigation(CardService.newNavigation().updateCard(card))
    .build();
}

// ===========================================================================
// API helpers
// ===========================================================================

/**
 * Fetch CRM context for a sender.
 * Returns { data } | { unauthorized:true } | { error }.
 */
function fetchContext(senderEmail, subject, messageId) {
  var payload = {
    senderEmail: senderEmail,
    subject: subject || undefined,
    messageId: messageId || undefined
  };
  var res = withAuthRetry('/addin/context', 'post', payload);
  if (res.unauthorized) return { unauthorized: true };
  if (res.status < 200 || res.status >= 300) {
    return { error: 'HTTP ' + res.status };
  }
  return { data: res.body || {} };
}

/**
 * Authenticated fetch with a single /auth/refresh retry on 401.
 * Returns { status, body, unauthorized? }.
 */
function withAuthRetry(path, method, payload) {
  var token = getAccessToken();
  if (!token) return { status: 401, body: {}, unauthorized: true };

  var res = apiFetch(path, method, payload, token);
  if (res.status !== 401) return res;

  // Try to refresh once.
  var refreshed = tryRefresh();
  if (!refreshed) return { status: 401, body: res.body, unauthorized: true };

  var res2 = apiFetch(path, method, payload, refreshed);
  if (res2.status === 401) return { status: 401, body: res2.body, unauthorized: true };
  return res2;
}

/**
 * Attempt to refresh the access token. Best-effort: if the response shape
 * differs from { accessToken }, we treat it as a failed refresh and the caller
 * falls back to the login card.
 * Returns the new access token string, or null.
 */
function tryRefresh() {
  var props = PropertiesService.getUserProperties();
  var refreshToken = props.getProperty(PROP_REFRESH);
  if (!refreshToken) return null;

  var res = apiFetch('/auth/refresh', 'post', { refreshToken: refreshToken });
  var body = res.body || {};
  if (res.status < 200 || res.status >= 300 || !body.accessToken) {
    return null;
  }
  props.setProperty(PROP_ACCESS, body.accessToken);
  if (body.refreshToken) {
    props.setProperty(PROP_REFRESH, body.refreshToken);
  }
  return body.accessToken;
}

/**
 * Low-level JSON fetch. Returns { status, body }.
 * `token` is optional; when present it's sent as a Bearer header.
 */
function apiFetch(path, method, payload, token) {
  var options = {
    method: method,
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {}
  };
  if (token) {
    options.headers.Authorization = 'Bearer ' + token;
  }
  if (payload !== undefined && payload !== null) {
    options.payload = JSON.stringify(payload);
  }

  var status = 0;
  var body = {};
  try {
    var response = UrlFetchApp.fetch(API_BASE + path, options);
    status = response.getResponseCode();
    var text = response.getContentText();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (parseErr) {
        body = { raw: text };
      }
    }
  } catch (err) {
    status = 0;
    body = { message: String(err) };
  }
  return { status: status, body: body };
}

// ===========================================================================
// Token storage
// ===========================================================================

function getAccessToken() {
  return PropertiesService.getUserProperties().getProperty(PROP_ACCESS);
}

function clearTokens() {
  var props = PropertiesService.getUserProperties();
  props.deleteProperty(PROP_ACCESS);
  props.deleteProperty(PROP_REFRESH);
}

// ===========================================================================
// Small utilities
// ===========================================================================

function notify(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}

function recordUrl(type, id) {
  if (!id) return null;
  var t = String(type || '').toLowerCase();
  if (t === 'client') return APP_BASE + '/clients/' + id;
  return APP_BASE + '/leads/' + id;
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, HH:mm');
  } catch (err) {
    return iso;
  }
}
