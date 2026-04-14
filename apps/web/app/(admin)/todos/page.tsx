'use client';

import { useState, useEffect, useCallback } from 'react';

interface Todo {
  id: string;
  description: string;
  completed: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/todos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = await res.json();
      setTodos(Array.isArray(json) ? json : json.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  async function add() {
    if (!input.trim()) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/todos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: input.trim() }),
    });
    setInput('');
    fetchTodos();
  }

  async function toggle(id: string) {
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/todos/${id}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchTodos();
  }

  async function remove(id: string) {
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/todos/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchTodos();
  }

  async function saveEdit(id: string) {
    if (!editValue.trim()) {
      setEditingId(null);
      return;
    }
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/todos/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: editValue.trim() }),
    });
    setEditingId(null);
    fetchTodos();
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Todos</h1>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Add a todo..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={add}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            Add
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading...</p>
        ) : todos.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">
            No todos yet — add one above.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="flex items-center gap-3 py-2 group"
              >
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggle(todo.id)}
                  className="w-4 h-4"
                />
                {editingId === todo.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => saveEdit(todo.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(todo.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm"
                  />
                ) : (
                  <span
                    onDoubleClick={() => {
                      setEditingId(todo.id);
                      setEditValue(todo.description);
                    }}
                    className={[
                      'flex-1 text-sm cursor-text select-none',
                      todo.completed
                        ? 'line-through text-gray-400'
                        : 'text-gray-800',
                    ].join(' ')}
                  >
                    {todo.description}
                  </span>
                )}
                <button
                  onClick={() => remove(todo.id)}
                  className="text-xs text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
