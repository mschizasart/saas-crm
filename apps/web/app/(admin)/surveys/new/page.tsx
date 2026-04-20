'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FormPageLayout } from '@/components/layouts/form-page-layout';
import { Button } from '@/components/ui/button';
import { typography } from '@/lib/ui-tokens';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type QType = 'text' | 'textarea' | 'radio' | 'checkbox' | 'rating';

interface QuestionDraft {
  question: string;
  type: QType;
  options: string[];
  required: boolean;
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function NewSurveyPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [questions, setQuestions] = useState<QuestionDraft[]>([
    { question: '', type: 'text', options: [], required: false },
  ]);
  const [saving, setSaving] = useState(false);

  function updateQ(i: number, patch: Partial<QuestionDraft>) {
    setQuestions((qs) =>
      qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)),
    );
  }

  function addQ() {
    setQuestions((qs) => [
      ...qs,
      { question: '', type: 'text', options: [], required: false },
    ]);
  }

  function removeQ(i: number) {
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/surveys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        description: description || undefined,
        active,
        questions: questions.map((q, i) => ({
          question: q.question,
          type: q.type,
          options:
            q.type === 'radio' || q.type === 'checkbox' ? q.options : [],
          required: q.required,
          order: i,
        })),
      }),
    });
    setSaving(false);
    if (res.ok) {
      const s = await res.json();
      router.push(`/surveys/${s.id}`);
    } else {
      alert('Failed to save survey');
    }
  }

  return (
    <FormPageLayout
      title="New Survey"
      onSubmit={submit}
      footer={
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Create Survey'}
        </Button>
      }
    >
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border rounded"
            rows={2}
          />
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span>Active</span>
        </label>

        <div className="space-y-4">
          <h2 className={typography.h3}>Questions</h2>
          {questions.map((q, i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-900 shadow rounded p-4 space-y-3 border"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Question {i + 1}</span>
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeQ(i)}
                    className="text-red-600 text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>

              <input
                required
                placeholder="Question text"
                value={q.question}
                onChange={(e) => updateQ(i, { question: e.target.value })}
                className="w-full px-3 py-2 border rounded"
              />

              <div className="flex items-center gap-3">
                <select
                  value={q.type}
                  onChange={(e) => updateQ(i, { type: e.target.value as QType })}
                  className="px-2 py-1 border rounded"
                >
                  <option value="text">Short text</option>
                  <option value="textarea">Long text</option>
                  <option value="radio">Single choice</option>
                  <option value="checkbox">Multiple choice</option>
                  <option value="rating">Rating (1-5)</option>
                </select>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => updateQ(i, { required: e.target.checked })}
                  />
                  Required
                </label>
              </div>

              {(q.type === 'radio' || q.type === 'checkbox') && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Options (one per line)
                  </label>
                  <textarea
                    value={q.options.join('\n')}
                    onChange={(e) =>
                      updateQ(i, {
                        options: e.target.value
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
                    rows={3}
                  />
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addQ}
            className="px-4 py-2 border border-dashed rounded text-blue-600"
          >
            + Add question
          </button>
        </div>
      </div>
    </FormPageLayout>
  );
}
