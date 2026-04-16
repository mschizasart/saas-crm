'use client';

import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function ChatWidgetSettingsPage() {
  const [orgSlug, setOrgSlug] = useState('YOUR_ORG_SLUG');
  const [enabled, setEnabled] = useState(false);
  const [color, setColor] = useState('#2563eb');
  const [welcome, setWelcome] = useState('Hi! How can we help you?');
  const [position, setPosition] = useState<'right' | 'left'>('right');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/organizations/current`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.slug) setOrgSlug(data.slug);
        const s = data.settings ?? {};
        if (s.chatWidgetEnabled != null) setEnabled(s.chatWidgetEnabled);
        if (s.chatWidgetColor) setColor(s.chatWidgetColor);
        if (s.chatWidgetWelcome) setWelcome(s.chatWidgetWelcome);
        if (s.chatWidgetPosition) setPosition(s.chatWidgetPosition);
      } catch { /* ignore */ }
    })();
  }, []);

  const snippet = `<script>
(function() {
  var w = document.createElement('div');
  w.id = 'appoinly-chat';
  document.body.appendChild(w);
  var s = document.createElement('script');
  s.src = '${API_BASE}/chat-widget.js';
  s.dataset.org = '${orgSlug}';
  s.dataset.api = '${API_BASE}';
  s.dataset.color = '${color}';
  s.dataset.welcome = '${welcome}';
  s.dataset.position = '${position}';
  document.body.appendChild(s);
})();
</script>`;

  function copySnippet() {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function saveSettings() {
    try {
      await fetch(`${API_BASE}/api/v1/organizations/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatWidgetEnabled: enabled,
          chatWidgetColor: color,
          chatWidgetWelcome: welcome,
          chatWidgetPosition: position,
        }),
      });
    } catch { /* ignore */ }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Live Chat Widget</h1>

      {/* Enable toggle */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary/30"
          />
          <div>
            <span className="text-sm font-medium text-gray-700">Enable Live Chat Widget</span>
            <p className="text-xs text-gray-500">Allow visitors to chat with your team in real-time</p>
          </div>
        </label>
      </div>

      {/* Customization */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Customization</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Primary Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 rounded border border-gray-200 cursor-pointer"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-32 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Welcome Message</label>
            <input
              type="text"
              value={welcome}
              onChange={(e) => setWelcome(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Position</label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as 'right' | 'left')}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="right">Bottom Right</option>
              <option value="left">Bottom Left</option>
            </select>
          </div>
          <button
            onClick={saveSettings}
            className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            Save Settings
          </button>
        </div>
      </div>

      {/* Embed code */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">Embed Code</h2>
          <button
            onClick={copySnippet}
            className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Paste this code before the closing <code>&lt;/body&gt;</code> tag on your website.
        </p>
        <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap">
          {snippet}
        </pre>
      </div>

      {/* Preview */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Preview</h2>
        <div className="relative bg-gray-100 rounded-lg h-[420px] overflow-hidden">
          {/* Simulated chat panel */}
          <div
            className="absolute bottom-4 w-[300px] h-[360px] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden"
            style={{ [position]: '16px' }}
          >
            <div className="px-4 py-3 text-white font-semibold text-sm" style={{ background: color }}>
              Chat with us
            </div>
            <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
              {welcome}
            </div>
            <div className="flex-1 p-3 space-y-2">
              <div className="text-xs bg-gray-100 text-gray-700 px-3 py-2 rounded-xl self-start max-w-[80%] w-fit">
                Hello! Need help with my account
              </div>
              <div
                className="text-xs text-white px-3 py-2 rounded-xl ml-auto max-w-[80%] w-fit"
                style={{ background: color }}
              >
                Hi there! I would be happy to help.
              </div>
            </div>
            <div className="flex gap-2 p-3 border-t border-gray-200">
              <div className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-400">
                Type a message...
              </div>
              <div className="px-3 py-2 text-white text-xs rounded-lg font-medium" style={{ background: color }}>
                Send
              </div>
            </div>
          </div>
          {/* Floating button */}
          <div
            className="absolute bottom-4 w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
            style={{ background: color, [position === 'right' ? 'left' : 'right']: '16px' }}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="#fff">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
