(function () {
  var script = document.currentScript || document.querySelector('script[data-org]');
  var orgSlug = script && script.dataset.org;
  if (!orgSlug) return;

  var API_URL = script.dataset.api || 'http://localhost:3001';
  var color = script.dataset.color || '#2563eb';
  var welcome = script.dataset.welcome || 'Hi! How can we help you?';
  var position = script.dataset.position || 'right';

  var visitorId = localStorage.getItem('appoinly_vid');
  if (!visitorId) { visitorId = 'v_' + Math.random().toString(36).substr(2, 12); localStorage.setItem('appoinly_vid', visitorId); }

  // Inject styles
  var style = document.createElement('style');
  style.textContent = [
    '.ac-btn{position:fixed;bottom:24px;' + position + ':24px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;z-index:99999;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.25);transition:transform .2s}',
    '.ac-btn:hover{transform:scale(1.08)}',
    '.ac-btn svg{width:28px;height:28px;fill:#fff}',
    '.ac-panel{position:fixed;bottom:92px;' + position + ':24px;width:350px;height:500px;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.18);z-index:99999;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '.ac-panel.open{display:flex}',
    '.ac-hdr{padding:16px;color:#fff;font-weight:600;font-size:15px;display:flex;align-items:center;justify-content:space-between}',
    '.ac-hdr button{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}',
    '.ac-welcome{padding:12px 16px;background:#f9fafb;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb}',
    '.ac-msgs{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px}',
    '.ac-msg{max-width:80%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;word-wrap:break-word}',
    '.ac-msg.visitor{align-self:flex-end;color:#fff;border-bottom-right-radius:4px}',
    '.ac-msg.staff{align-self:flex-start;background:#f3f4f6;color:#1f2937;border-bottom-left-radius:4px}',
    '.ac-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e5e7eb;background:#fff}',
    '.ac-form input{flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;outline:none}',
    '.ac-form input:focus{border-color:' + color + '}',
    '.ac-form button{border:none;color:#fff;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:500}',
    '.ac-intro{padding:12px;border-top:1px solid #e5e7eb;background:#fafafa}',
    '.ac-intro input{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:6px;outline:none;box-sizing:border-box}',
  ].join('\n');
  document.head.appendChild(style);

  // Create elements
  var btn = document.createElement('button');
  btn.className = 'ac-btn';
  btn.style.background = color;
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h11zm4 0h2v2h-2z"/></svg>';
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.className = 'ac-panel';
  panel.innerHTML =
    '<div class="ac-hdr" style="background:' + color + '"><span>Chat with us</span><button class="ac-close">&times;</button></div>' +
    '<div class="ac-welcome">' + welcome + '</div>' +
    '<div class="ac-msgs"></div>' +
    '<div class="ac-intro"><input class="ac-name" placeholder="Your name (optional)"><input class="ac-email" placeholder="Your email (optional)"></div>' +
    '<div class="ac-form"><input class="ac-input" placeholder="Type a message..." /><button class="ac-send" style="background:' + color + '">Send</button></div>';
  document.body.appendChild(panel);

  var msgs = panel.querySelector('.ac-msgs');
  var input = panel.querySelector('.ac-input');
  var nameInput = panel.querySelector('.ac-name');
  var emailInput = panel.querySelector('.ac-email');
  var intro = panel.querySelector('.ac-intro');
  var isOpen = false;
  var started = false;
  var socket = null;

  btn.onclick = function () {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    if (isOpen && !socket) connectSocket();
  };
  panel.querySelector('.ac-close').onclick = function () {
    isOpen = false;
    panel.classList.remove('open');
  };

  function addMsg(text, type) {
    var el = document.createElement('div');
    el.className = 'ac-msg ' + type;
    if (type === 'visitor') el.style.background = color;
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function connectSocket() {
    var ioScript = document.createElement('script');
    ioScript.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
    ioScript.onload = function () {
      socket = io(API_URL + '/chat', {
        query: { orgSlug: orgSlug, visitorId: visitorId },
        transports: ['websocket', 'polling'],
      });
      socket.on('reply', function (data) {
        addMsg(data.message, 'staff');
      });
    };
    document.head.appendChild(ioScript);
  }

  function sendMessage() {
    var text = input.value.trim();
    if (!text || !socket) return;
    if (!started) {
      started = true;
      intro.style.display = 'none';
    }
    addMsg(text, 'visitor');
    socket.emit('message', {
      name: nameInput.value.trim() || undefined,
      email: emailInput.value.trim() || undefined,
      message: text,
    });
    input.value = '';
  }

  panel.querySelector('.ac-send').onclick = sendMessage;
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });
})();
