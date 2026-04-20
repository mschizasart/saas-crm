'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Question {
  id: string;
  question: string;
  type: string;
  options: string[];
  required: boolean;
  order: number;
}

interface Survey {
  id: string;
  name: string;
  description?: string | null;
  questions: Question[];
}

export default function PublicSurveyPage() {
  const params = useParams();
  const hash = params?.hash as string;
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hash) return;
    fetch(`${API_BASE}/api/v1/surveys/public/${hash}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setSurvey)
      .catch(() => setError('Survey not found'));
  }, [hash]);

  function setAnswer(qid: string, val: any) {
    setAnswers((a) => ({ ...a, [qid]: val }));
  }

  function toggleCheckbox(qid: string, option: string) {
    setAnswers((a) => {
      const cur: string[] = Array.isArray(a[qid]) ? a[qid] : [];
      return {
        ...a,
        [qid]: cur.includes(option)
          ? cur.filter((x) => x !== option)
          : [...cur, option],
      };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch(
      `${API_BASE}/api/v1/surveys/public/${hash}/submit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, email: email || undefined }),
      },
    );
    setSubmitting(false);
    if (res.ok) {
      setDone(true);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? 'Failed to submit');
    }
  }

  if (error && !survey)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600">{error}</p>
      </div>
    );
  if (!survey)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading…</p>
      </div>
    );

  if (done)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
        <div className="bg-white dark:bg-gray-900 p-8 rounded shadow text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">Thank you!</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Your response has been recorded.
          </p>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <form
        onSubmit={submit}
        className="max-w-2xl mx-auto bg-white dark:bg-gray-900 p-6 rounded shadow space-y-6"
      >
        <div>
          <h1 className="text-2xl font-bold">{survey.name}</h1>
          {survey.description && (
            <p className="text-gray-600 dark:text-gray-400 mt-1">{survey.description}</p>
          )}
        </div>

        {survey.questions.map((q, i) => (
          <div key={q.id} className="space-y-2">
            <label className="block font-medium">
              {i + 1}. {q.question}
              {q.required && <span className="text-red-600 ml-1">*</span>}
            </label>

            {q.type === 'text' && (
              <input
                required={q.required}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                className="w-full px-3 py-2 border rounded"
              />
            )}

            {q.type === 'textarea' && (
              <textarea
                required={q.required}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border rounded"
              />
            )}

            {q.type === 'radio' &&
              q.options.map((o) => (
                <label key={o} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={q.id}
                    checked={answers[q.id] === o}
                    onChange={() => setAnswer(q.id, o)}
                    required={q.required}
                  />
                  {o}
                </label>
              ))}

            {q.type === 'checkbox' &&
              q.options.map((o) => (
                <label key={o} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={
                      Array.isArray(answers[q.id]) &&
                      answers[q.id].includes(o)
                    }
                    onChange={() => toggleCheckbox(q.id, o)}
                  />
                  {o}
                </label>
              ))}

            {q.type === 'rating' && (
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAnswer(q.id, n)}
                    className={`w-10 h-10 rounded border ${
                      answers[q.id] === n
                        ? 'bg-blue-600 text-white'
                        : 'bg-white'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        <div>
          <label className="block text-sm font-medium mb-1">
            Your email (optional)
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </form>
    </div>
  );
}
